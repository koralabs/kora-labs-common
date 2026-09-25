import assert from 'node:assert/strict';
import { errors, types } from 'cassandra-driver';

import {
    acquireWithExecutor,
    CqlExecutor,
    CronLockTopology,
    leaseMs,
    releaseWithExecutor,
    resolveMode,
    resolveTopology
} from './cqlCronLock';

const topology: CronLockTopology = {
    network: 'preview',
    nodeCode: 'sfo',
    mintNodes: ['sfo', 'rdm'],
    localDataCenter: 'kora-dc1',
    contactPoints: ['scylla.internal:9042']
};

const responseError = (code: number): Error => {
    const error = Object.create(errors.ResponseError.prototype) as Error & { code: number };
    error.code = code;
    error.message = 'test response error';
    return error;
};

describe('CQL cron-lock acquisition', () => {
    // Invariant: concurrent ticks on one node have distinct owners and only one can acquire.
    // Failure caught: node-code ownership made both same-node invocations look re-entrant.
    // Negative control: changing the two generated tokens to one shared token makes both acquire.
    it('allows exactly one of two concurrent same-node acquisitions', async () => {
        let owner: string | undefined;
        const executor: CqlExecutor = {
            async execute(query, params = []) {
                if (query.startsWith('INSERT')) {
                    const candidate = params[1] as string;
                    if (!owner) {
                        owner = candidate;
                        return { rows: [{ '[applied]': true }] };
                    }
                    return { rows: [{ '[applied]': false, owner }] };
                }
                return { rows: [{ '[applied]': owner === params[3] }] };
            }
        };

        const results = await Promise.all([
            acquireWithExecutor(executor, 'lock.mintPaidSessionsLock', 'none', topology),
            acquireWithExecutor(executor, 'lock.mintPaidSessionsLock', 'none', topology)
        ]);

        assert.deepEqual(results.map((result) => result.status).sort(), ['acquired', 'held']);
        const acquired = results.find((result) => result.status === 'acquired');
        assert.match(acquired?.token ?? '', /^sfo:[0-9a-f-]{36}$/);
    });

    // Invariant: ownership refresh succeeds only when the conditional UPDATE was applied.
    // Failure caught: the old path ignored [applied] and minted after losing ownership.
    // Negative control: returning [applied]: true below changes the result to acquired.
    it('treats a rejected conditional refresh as held', async () => {
        let calls = 0;
        const executor: CqlExecutor = {
            async execute() {
                calls += 1;
                return calls === 1
                    ? { rows: [{ '[applied]': false, owner: 'sfo:attempt' }] }
                    : { rows: [{ '[applied]': false, owner: 'sfo:newer-attempt' }] };
            }
        };

        assert.deepEqual(
            await acquireWithExecutor(executor, 'lock.mintPaidSessionsLock', 'none', topology, 'sfo:attempt'),
            { status: 'held' }
        );
        assert.equal(calls, 2);
    });

    // Invariant: only a definite SERIAL UNAVAILABLE response enables caller consideration of fallback.
    // Failure caught: timeouts and arbitrary driver/config failures were all classified as peer loss.
    // Negative controls: write timeout, generic error, and LOCAL_SERIAL all remain unavailable.
    it('classifies only a SERIAL unavailable response as peer unavailable', async () => {
        const failing = (error: Error): CqlExecutor => ({ execute: async () => Promise.reject(error) });
        const unavailable = responseError(types.responseErrorCodes.unavailableException);
        const writeTimeout = responseError(types.responseErrorCodes.writeTimeout);

        assert.equal((await acquireWithExecutor(failing(unavailable), 'lock', 'none', topology)).status, 'peerUnavailable');
        assert.equal((await acquireWithExecutor(failing(writeTimeout), 'lock', 'none', topology)).status, 'unavailable');
        assert.equal((await acquireWithExecutor(failing(new Error('bad schema')), 'lock', 'none', topology)).status, 'unavailable');
        assert.equal((await acquireWithExecutor(failing(unavailable), 'lock', 'rdm', topology)).status, 'unavailable');
    });

    // Invariant: topology and offline membership are explicit and internally consistent.
    // Failure caught: missing variables silently became an inferred one-node topology.
    // Negative control: the complete topology below resolves and selects SERIAL.
    it('fails closed for missing or incoherent topology', () => {
        assert.throws(() => resolveTopology({}), /NETWORK is required/);
        assert.throws(
            () => resolveTopology({ NETWORK: 'PREVIEW', KORA_NODE_CODE: 'sfo', KORA_MINT_NODES: 'rdm', KORA_SCYLLA_DC: 'kora-dc1', KORA_CQL_CONTACT_POINTS: 'host:9042' }),
            /not present/
        );
        assert.throws(() => resolveMode(['bogus'], topology), /unknown mint node/);

        const resolved = resolveTopology({
            NETWORK: 'PREVIEW',
            KORA_NODE_CODE: 'sfo',
            KORA_MINT_NODES: 'sfo,rdm',
            KORA_SCYLLA_DC: 'kora-dc1',
            KORA_CQL_CONTACT_POINTS: 'host:9042'
        });
        assert.equal(resolveMode([], resolved), 'serial');
        assert.equal(resolveMode(['rdm'], resolved), 'localSerial');
        assert.equal(resolveMode(['sfo'], resolved), 'standDown');
    });

    // Invariant: a caller-chosen lease is the TTL written with the lock (a crashed short job must not
    // block its successor for the 30-minute default).
    // Failure caught: every lock silently used STALE_EXECUTING_CRON_LOCK_MS / 30 min.
    // Negative control: dropping the `lease` argument makes the INSERT carry TTL 1800.
    it('writes the caller-chosen lease as the lock TTL', async () => {
        const queries: string[] = [];
        const executor: CqlExecutor = {
            async execute(query) {
                queries.push(query);
                return { rows: [{ '[applied]': true }] };
            }
        };
        const result = await acquireWithExecutor(executor, 'lock.halEngine', 'none', topology, 'sfo:t', 600_000);
        assert.equal(result.status, 'acquired');
        assert.match(queries[0], /IF NOT EXISTS USING TTL 600$/);
        assert.throws(() => leaseMs(0), /Invalid cron-lock lease/);
    });

    // Invariant: an LWT that timed out but WAS applied with this invocation's token is recognised as acquired.
    // Failure caught: 'Server timeout during write query at consistency SERIAL' (seen several times a day on
    // the SFO/RDM pair) left the lock written with a token nobody knew — every box stood down until the
    // lease expired (HAL engine: 10 min; minting: 30 min).
    // Negative control: without the serial read-back the first case below returns 'unavailable'.
    it('resolves a timed-out acquisition by reading the owner at serial consistency', async () => {
        const writeTimeout = responseError(types.responseErrorCodes.writeTimeout);
        const table = (ownerAfterTimeout: string | undefined, readFails = false): CqlExecutor => ({
            async execute(query, _params, options) {
                if (query.startsWith('INSERT')) throw writeTimeout;
                if (query.startsWith('SELECT')) {
                    assert.equal((options as { consistency: number }).consistency, types.consistencies.serial);
                    if (readFails) throw writeTimeout;
                    return { rows: ownerAfterTimeout ? [{ owner: ownerAfterTimeout }] : [] };
                }
                throw new Error(`unexpected ${query}`);
            }
        });

        assert.deepEqual(await acquireWithExecutor(table('sfo:me'), 'lock', 'none', topology, 'sfo:me'), { status: 'acquired', token: 'sfo:me' });
        assert.deepEqual(await acquireWithExecutor(table('rdm:other'), 'lock', 'none', topology, 'sfo:me'), { status: 'held' });
        assert.equal((await acquireWithExecutor(table(undefined), 'lock', 'none', topology, 'sfo:me')).status, 'unavailable');
        assert.equal((await acquireWithExecutor(table('sfo:me', true), 'lock', 'none', topology, 'sfo:me')).status, 'unavailable');
    });

    // Invariant: an invocation that cannot learn whether its timed-out write committed, and so will not
    // run, retracts it (only if it is its own) instead of leaving every box idle for the lease.
    // Seen live 2026-09-25 00:25 UTC: write and read-back both timed out; the row blocked the engine 10 min.
    // Negative control: without the retraction the row survives the failed acquisition.
    it('retracts its own possibly-applied write when the outcome stays unknown', async () => {
        const writeTimeout = responseError(types.responseErrorCodes.writeTimeout);
        const rows = new Map<string, string>();
        const executor: CqlExecutor = {
            async execute(query, params = []) {
                if (query.startsWith('INSERT')) {
                    if (!rows.has(params[0] as string)) rows.set(params[0] as string, params[1] as string); // IF NOT EXISTS committed…
                    throw writeTimeout; // …but the reply timed out
                }
                if (query.startsWith('SELECT')) throw writeTimeout; // read-back times out too
                if (query.startsWith('DELETE')) {
                    const [name, owner] = params as string[];
                    if (rows.get(name) === owner) rows.delete(name);
                    return { rows: [{ '[applied]': true }] };
                }
                throw new Error(`unexpected ${query}`);
            }
        };
        const result = await acquireWithExecutor(executor, 'lock', 'none', topology, 'sfo:me');
        assert.equal(result.status, 'unavailable');
        assert.match((result as { message: string }).message, /retracted our proposal/);
        assert.equal(rows.size, 0);

        // Another box's lock is never retracted by us.
        rows.set('preview:lock', 'rdm:other');
        assert.equal((await acquireWithExecutor(executor, 'lock', 'none', topology, 'sfo:me')).status, 'unavailable');
        assert.equal(rows.get('preview:lock'), 'rdm:other');
    });

    // Invariant: a coordinator that never replied (client-side readTimeout) leaves the LWT outcome just as
    // unknown as a server write timeout, so it is resolved the same way.
    // Failure caught: OperationTimedOutError ("The host … did not reply before timeout 12000 ms", seen on
    // the SFO/RDM pair) skipped the owner read, so an INSERT that had committed idled every box for the lease.
    // Negative control: classifying only ResponseError.writeTimeout returns 'unavailable' and leaves the row.
    it('resolves an acquisition whose coordinator never replied like a write timeout', async () => {
        const rows = new Map<string, string>();
        const executor: CqlExecutor = {
            async execute(query, params = []) {
                if (query.startsWith('INSERT')) {
                    if (!rows.has(params[0] as string)) rows.set(params[0] as string, params[1] as string);
                    throw new errors.OperationTimedOutError('The host 100.94.227.122:9042 did not reply before timeout 12000 ms');
                }
                if (query.startsWith('SELECT')) return { rows: rows.has(params[0] as string) ? [{ owner: rows.get(params[0] as string) }] : [] };
                throw new Error(`unexpected ${query}`);
            }
        };
        assert.deepEqual(await acquireWithExecutor(executor, 'lock', 'none', topology, 'sfo:me'), { status: 'acquired', token: 'sfo:me' });
        assert.equal(rows.get('preview:lock'), 'sfo:me');
    });
});

describe('CQL cron-lock release', () => {
    /** kora_locks.cron_lock with LWT semantics, whose DELETEs fail per `deleteFailures` (after or before committing). */
    const lockTable = (deleteFailures: Array<'appliedThenTimeout' | 'timeout'>, readFails = false) => {
        const rows = new Map<string, string>();
        let deletes = 0;
        const executor: CqlExecutor = {
            async execute(query, params = []) {
                const [name, owner] = params as string[];
                if (query.startsWith('SELECT')) {
                    if (readFails) throw responseError(types.responseErrorCodes.readTimeout);
                    return { rows: rows.has(name) ? [{ owner: rows.get(name) }] : [] };
                }
                if (query.startsWith('DELETE')) {
                    const failure = deleteFailures[deletes++];
                    if (failure === 'timeout') throw responseError(types.responseErrorCodes.writeTimeout);
                    const applied = rows.get(name) === owner;
                    if (applied) rows.delete(name);
                    if (failure === 'appliedThenTimeout') throw new errors.OperationTimedOutError('The host 100.124.13.105:9042 did not reply before timeout 12000 ms');
                    return { rows: [{ '[applied]': applied }] };
                }
                throw new Error(`unexpected ${query}`);
            }
        };
        return { rows, executor, deletes: () => deletes };
    };

    // Invariant: a finished job's lock row does not outlive it because its DELETE timed out.
    // Failure caught: live mainnet 2026-09-24 21:45 UTC, "release best-effort failed (TTL will reclaim): Server
    // timeout during write query at consistency SERIAL" for mintPaidSessionsLock — an uncommitted delete left
    // the row, and no box could mint until the 30-minute lease expired.
    // Negative control: the previous release (one DELETE, errors swallowed) leaves 'sfo:me' in the table.
    it('deletes its row again when a timed-out DELETE did not commit', async () => {
        const table = lockTable(['timeout']);
        table.rows.set('preview:lock.mintPaidSessionsLock', 'sfo:me');
        assert.deepEqual(await releaseWithExecutor(table.executor, 'lock.mintPaidSessionsLock', 'sfo:me', 'none', topology), { status: 'released' });
        assert.equal(table.rows.size, 0);
        assert.equal(table.deletes(), 2);
    });

    it('does not delete again when the timed-out DELETE had committed', async () => {
        const table = lockTable(['appliedThenTimeout']);
        table.rows.set('preview:lock', 'sfo:me');
        assert.deepEqual(await releaseWithExecutor(table.executor, 'lock', 'sfo:me', 'none', topology), { status: 'released' });
        assert.equal(table.rows.size, 0);
        assert.equal(table.deletes(), 1);
    });

    // Invariant: release never frees another invocation's lock, even while resolving a timeout.
    it('leaves a row another box acquired after our timed-out DELETE', async () => {
        const table = lockTable(['appliedThenTimeout']);
        table.rows.set('preview:lock', 'sfo:me');
        const racing: CqlExecutor = {
            async execute(query, params, options) {
                const result = await table.executor.execute(query, params, options).catch((error) => {
                    table.rows.set('preview:lock', 'rdm:other'); // the peer won the freed lock before our read
                    throw error;
                });
                return result;
            }
        };
        assert.deepEqual(await releaseWithExecutor(racing, 'lock', 'sfo:me', 'none', topology), { status: 'released' });
        assert.equal(table.rows.get('preview:lock'), 'rdm:other');
        assert.equal(table.deletes(), 1);
    });

    // Failure case: when neither the delete nor the owner read succeeds, the outcome is reported as unknown
    // (the caller logs a WARN; the lease TTL is the remaining recovery).
    it('reports an unknown release when the owner cannot be read', async () => {
        const table = lockTable(['timeout'], true);
        table.rows.set('preview:lock', 'sfo:me');
        const result = await releaseWithExecutor(table.executor, 'lock', 'sfo:me', 'none', topology);
        assert.equal(result.status, 'unknown');
        assert.match((result as { message: string }).message, /owner read failed/);
        assert.equal(table.rows.get('preview:lock'), 'sfo:me');
    });

    it('stands down without touching the table on a box declared offline', async () => {
        const table = lockTable([]);
        table.rows.set('preview:lock', 'sfo:me');
        assert.deepEqual(await releaseWithExecutor(table.executor, 'lock', 'sfo:me', 'sfo', topology), { status: 'released' });
        assert.equal(table.deletes(), 0);
    });
});
