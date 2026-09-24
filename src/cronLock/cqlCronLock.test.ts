import assert from 'node:assert/strict';
import { errors, types } from 'cassandra-driver';

import {
    acquireWithExecutor,
    CqlExecutor,
    CronLockTopology,
    leaseMs,
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
});
