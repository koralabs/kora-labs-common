/**
 * Cross-datacenter cron mutex for the self-hosted, multi-DC Scylla topology.
 * (Moved from minting.handle.me src/helpers/cronLock/cqlCronLock.ts @ 6ecb9c3 so every box cron
 * — minting.handle.me, hal-minting-engine — shares one implementation.)
 *
 * Minting runs active/active across boxes, each in its own Scylla datacenter with
 * RF=1 per DC. Alternator conditional writes use LOCAL_SERIAL, so each DC can win
 * independently. CQL SERIAL is the cross-DC mutex.
 *
 * Operators declare unavailable boxes through the offline set:
 *  - all boxes online: SERIAL / QUORUM;
 *  - this box offline: stand down;
 *  - this box is the only declared-online box: LOCAL_SERIAL / LOCAL_QUORUM;
 *  - an undeclared peer outage: 'peerUnavailable'. Callers whose job is safe on one
 *    box (on-chain/idempotent) may take a DC-local fallback, and only after this
 *    definite CQL UNAVAILABLE response (never after a timeout or unknown failure).
 *
 * The row TTL recovers crashed holders. Unique per-invocation owner tokens prevent
 * overlapping ticks on one box from mistaking node identity for lock ownership.
 */
import { randomUUID } from 'node:crypto';
import { errors, types } from 'cassandra-driver';
import { LogCategory, Logger } from '../logger';
import { createCqlExecutor } from './cqlClient';

const KEYSPACE = 'kora_locks';
const LOCK_TABLE = 'cron_lock';
const DEFAULT_LEASE_MS = 30 * 60 * 1000;

export interface CronLockTopology {
    network: string;
    nodeCode: string;
    mintNodes: string[];
    localDataCenter: string;
    contactPoints: string[];
}

export interface CqlExecutor {
    execute(query: string, params?: unknown[], options?: Record<string, unknown>): Promise<{ rows: unknown[] }>;
}

export type AcquireResult =
    | { status: 'acquired'; token: string }
    | { status: 'held' }
    | { status: 'peerUnavailable'; token: string; message: string }
    | { status: 'unavailable'; message: string };

const required = (env: NodeJS.ProcessEnv, name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for cron-lock topology`);
    return value;
};

const parseList = (value: string): string[] => [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];

/** A missing or incoherent topology is unsafe: never infer a one-node cluster. */
export const resolveTopology = (env: NodeJS.ProcessEnv = process.env): CronLockTopology => {
    const network = required(env, 'NETWORK').toLowerCase();
    const nodeCode = required(env, 'KORA_NODE_CODE').toLowerCase();
    const mintNodes = parseList(required(env, 'KORA_MINT_NODES'));
    const localDataCenter = required(env, 'KORA_SCYLLA_DC');
    const contactPoints = parseList(required(env, 'KORA_CQL_CONTACT_POINTS'));

    if (!mintNodes.includes(nodeCode)) {
        throw new Error(`KORA_NODE_CODE '${nodeCode}' is not present in KORA_MINT_NODES`);
    }
    if (contactPoints.length === 0) {
        throw new Error('KORA_CQL_CONTACT_POINTS must contain at least one contact point');
    }

    return { network, nodeCode, mintNodes, localDataCenter, contactPoints };
};

/**
 * Lease (TTL) of a held lock: how long a crashed holder blocks the next run. Callers pass the lease
 * their job needs (it must exceed the job's maximum run time); the default honors
 * STALE_EXECUTING_CRON_LOCK_MS, else 30 minutes.
 */
export const leaseMs = (override?: number): number => {
    if (override !== undefined) {
        if (!Number.isFinite(override) || override <= 0) throw new Error(`Invalid cron-lock lease ${override}`);
        return override;
    }
    const parsed = Number(process.env.STALE_EXECUTING_CRON_LOCK_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEASE_MS;
};

const leaseSeconds = (override?: number) => Math.ceil(leaseMs(override) / 1000);

const scopeName = (name: string, topology: CronLockTopology): string => `${topology.network}:${name}`;

let client: CqlExecutor | null = null;
let clientTopologyKey = '';
const ensured = new WeakSet<CqlExecutor>();

const getClient = (topology: CronLockTopology): CqlExecutor => {
    const topologyKey = JSON.stringify([topology.contactPoints, topology.localDataCenter]);
    if (!client || clientTopologyKey !== topologyKey) {
        client = createCqlExecutor(topology);
        clientTopologyKey = topologyKey;
    }
    return client;
};

/**
 * Schema changes need a majority of the whole cluster, so with a peer DC down a CREATE … IF NOT EXISTS
 * hangs until the driver times out — masking the definite UNAVAILABLE the one-box solo path relies on
 * (incident 2026-10-07). system_schema is replicated to every node (LocalStrategy), so reading it
 * needs no peer; DDL is issued only on a cluster that really lacks the table.
 */
const ensureSchema = async (executor: CqlExecutor): Promise<void> => {
    if (ensured.has(executor)) return;
    const existing = await executor.execute(
        'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?',
        [KEYSPACE, LOCK_TABLE],
        { prepare: true, consistency: types.consistencies.localOne }
    );
    if (existing.rows.length === 0) {
        await executor.execute(
            `CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE} WITH replication = ` +
                `{'class':'NetworkTopologyStrategy','kora-dc1':1,'kora-dc2':1}`
        );
        await executor.execute(
            `CREATE TABLE IF NOT EXISTS ${KEYSPACE}.${LOCK_TABLE} (name text PRIMARY KEY, owner text, acquired_at timestamp)`
        );
    }
    ensured.add(executor);
};

export const parseOffline = (raw: string | undefined | null): string[] => {
    const value = (raw ?? '').trim().toLowerCase();
    if (!value || value === 'none') return [];
    return parseList(value);
};

type Mode = 'serial' | 'localSerial' | 'standDown';

export const resolveMode = (offline: string[], topology: CronLockTopology): Mode => {
    const unknownNodes = offline.filter((node) => !topology.mintNodes.includes(node));
    if (unknownNodes.length > 0) {
        throw new Error(`Offline set contains unknown mint node(s): ${unknownNodes.join(',')}`);
    }
    if (offline.includes(topology.nodeCode)) return 'standDown';
    const online = topology.mintNodes.filter((node) => !offline.includes(node));
    return online.length === 1 ? 'localSerial' : 'serial';
};

const createToken = (topology: CronLockTopology): string => `${topology.nodeCode}:${randomUUID()}`;

/**
 * Only an UNAVAILABLE response proves that no SERIAL proposal was accepted. The driver's default retry
 * policy retries UNAVAILABLE on the next host and then throws NoHostAvailableError wrapping each host's
 * error, so that counts only when every host tried answered UNAVAILABLE.
 */
export const isPeerUnavailableError = (error: unknown): boolean => {
    if (error instanceof errors.NoHostAvailableError) {
        const inner = Object.values(error.innerErrors ?? {});
        return inner.length > 0 && inner.every(isPeerUnavailableError);
    }
    return error instanceof errors.ResponseError && error.code === types.responseErrorCodes.unavailableException;
};

/** A write timeout leaves an LWT's outcome unknown: the proposal may or may not have been applied. */
export const isWriteTimeoutError = (error: unknown): boolean =>
    error instanceof errors.ResponseError && error.code === types.responseErrorCodes.writeTimeout;

/**
 * An LWT whose outcome is unknown: the coordinator reported a write timeout, or it never replied within
 * the driver's readTimeout ("The host … did not reply before timeout") — either way it may have committed.
 */
export const isUnknownOutcomeError = (error: unknown): boolean =>
    isWriteTimeoutError(error) || error instanceof errors.OperationTimedOutError ||
    (error instanceof errors.NoHostAvailableError && Object.values(error.innerErrors ?? {}).some(isUnknownOutcomeError));

/**
 * The directly testable LWT operation. Each invocation owns a unique token, so
 * concurrent ticks on one node cannot both treat the node identity as ownership.
 */
export const acquireWithExecutor = async (
    executor: CqlExecutor,
    name: string,
    offline: string | null | undefined,
    topology: CronLockTopology,
    token = createToken(topology),
    lease?: number
): Promise<AcquireResult> => {
    const mode = resolveMode(parseOffline(offline), topology);
    if (mode === 'standDown') return { status: 'held' };

    const serialConsistency = mode === 'localSerial' ? types.consistencies.localSerial : types.consistencies.serial;
    const consistency = mode === 'localSerial' ? types.consistencies.localQuorum : types.consistencies.quorum;
    const key = scopeName(name, topology);
    let refreshing = false;

    try {
        const result = await executor.execute(
            `INSERT INTO ${KEYSPACE}.${LOCK_TABLE} (name, owner, acquired_at) VALUES (?, ?, ?) IF NOT EXISTS USING TTL ${leaseSeconds(lease)}`,
            [key, token, new Date()],
            { prepare: true, serialConsistency, consistency }
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (row?.['[applied]'] === true) return { status: 'acquired', token };
        if (row?.owner !== token) return { status: 'held' };

        refreshing = true;
        const refresh = await executor.execute(
            `UPDATE ${KEYSPACE}.${LOCK_TABLE} USING TTL ${leaseSeconds(lease)} SET owner = ?, acquired_at = ? WHERE name = ? IF owner = ?`,
            [token, new Date(), key, token],
            { prepare: true, serialConsistency, consistency }
        );
        const refreshRow = refresh.rows[0] as Record<string, unknown> | undefined;
        return refreshRow?.['[applied]'] === true ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mode === 'serial' && !refreshing && isPeerUnavailableError(error)) {
            return { status: 'peerUnavailable', token, message };
        }
        if (refreshing || isUnknownOutcomeError(error)) {
            // The LWT timed out: it may have been applied WITH OUR TOKEN, in which case nobody (not even
            // us) could run until the lease expired. A read at the same serial consistency completes any
            // in-flight Paxos round, so it tells us the real owner.
            const read = await readOwner(executor, key, serialConsistency);
            if (read.owner === token && !refreshing) return { status: 'acquired', token };
            if (read.owner && read.owner !== token) return { status: 'held' };
            if (refreshing && read.owner === token) {
                const retracted = await deleteIfOwner(executor, key, token, serialConsistency, consistency);
                return { status: 'unavailable', message: `${message}; lease renewal unconfirmed; ${retracted ? 'retracted our proposal' : 'retract failed, the lease will reclaim it'}` };
            }
            if (read.error) {
                // Still unknown and we will not run: retract our possibly-applied proposal so it cannot
                // block every box for the whole lease. Conditional on our token, so it never frees another's lock.
                const retracted = await deleteIfOwner(executor, key, token, serialConsistency, consistency);
                return { status: 'unavailable', message: `${message}; owner read failed (${read.error}); ${retracted ? 'retracted our proposal' : 'retract failed, the lease will reclaim it'}` };
            }
        }
        return { status: 'unavailable', message };
    }
};

/** The lock's owner as a linearizable (serial) read sees it. */
const readOwner = async (executor: CqlExecutor, key: string, serialConsistency: number): Promise<{ owner?: string; error?: string }> => {
    try {
        const result = await executor.execute(`SELECT owner FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ?`, [key], { prepare: true, consistency: serialConsistency });
        const owner = (result.rows[0] as Record<string, unknown> | undefined)?.owner;
        return typeof owner === 'string' ? { owner } : {};
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
};

const deleteIfOwner = async (executor: CqlExecutor, key: string, token: string, serialConsistency: number, consistency: number): Promise<boolean> => {
    try {
        await executor.execute(`DELETE FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ? IF owner = ?`, [key, token], { prepare: true, serialConsistency, consistency });
        return true;
    } catch {
        return false;
    }
};

/** One fresh process's acquisition: make sure the lock table exists, then take the lock. */
export const acquireOnExecutor = async (
    executor: CqlExecutor,
    name: string,
    offline: string | null | undefined,
    topology: CronLockTopology,
    lease?: number
): Promise<AcquireResult> => {
    await ensureSchema(executor);
    return acquireWithExecutor(executor, name, offline, topology, undefined, lease);
};

export const acquire = async (name: string, offline?: string | null, options: { leaseMs?: number } = {}): Promise<AcquireResult> => {
    try {
        const topology = resolveTopology();
        const result = await acquireOnExecutor(getClient(topology), name, offline, topology, options.leaseMs);
        if (result.status === 'peerUnavailable') {
            Logger.log({
                message: `cron lock '${name}' SERIAL unavailable because the configured peer quorum is unavailable: ${result.message}`,
                event: 'cqlCronLock.acquire.peerUnavailable',
                category: LogCategory.WARN
            });
        } else if (result.status === 'unavailable') {
            Logger.log({
                message: `cron lock '${name}' failed without a positively identified peer-unavailable response: ${result.message}`,
                event: 'cqlCronLock.acquire.unavailable',
                category: LogCategory.WARN
            });
        }
        return result;
    } catch (error) {
        Logger.log({
            message: `cron lock '${name}' is unavailable: ${(error as Error).message}`,
            event: 'cqlCronLock.acquire.unavailable',
            category: LogCategory.WARN
        });
        return { status: 'unavailable', message: (error as Error).message };
    }
};

export type ReleaseResult = { status: 'released' } | { status: 'unknown'; message: string };

/**
 * Release only the exact acquisition token owned by this invocation. The conditional DELETE is an LWT
 * too: when it fails its outcome is unknown, and a surviving row would idle the job on every box for
 * the whole lease. A serial read completes any in-flight Paxos round and tells whether the row is still
 * ours; if it is, the (token-conditional) delete is issued once more.
 */
export const releaseWithExecutor = async (
    executor: CqlExecutor,
    name: string,
    token: string,
    offline: string | null | undefined,
    topology: CronLockTopology
): Promise<ReleaseResult> => {
    const mode = resolveMode(parseOffline(offline), topology);
    if (mode === 'standDown') return { status: 'unknown', message: 'This box is declared offline; release was not attempted' };
    const serialConsistency = mode === 'localSerial' ? types.consistencies.localSerial : types.consistencies.serial;
    const consistency = mode === 'localSerial' ? types.consistencies.localQuorum : types.consistencies.quorum;
    const key = scopeName(name, topology);

    try {
        await executor.execute(`DELETE FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ? IF owner = ?`, [key, token], { prepare: true, serialConsistency, consistency });
        return { status: 'released' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const read = await readOwner(executor, key, serialConsistency);
        if (read.error) return { status: 'unknown', message: `${message}; owner read failed (${read.error})` };
        if (read.owner !== token) return { status: 'released' };
        return (await deleteIfOwner(executor, key, token, serialConsistency, consistency))
            ? { status: 'released' }
            : { status: 'unknown', message: `${message}; the row is still ours and the second delete failed` };
    }
};

export const release = async (name: string, token: string, offline?: string | null): Promise<void> => {
    try {
        const topology = resolveTopology();
        const result = await releaseWithExecutor(getClient(topology), name, token, offline, topology);
        if (result.status === 'unknown') {
            Logger.log({
                message: `cron lock '${name}' release failed; if the row survived, '${name}' idles on every box until its lease expires: ${result.message}`,
                event: 'cqlCronLock.release.unknown',
                category: LogCategory.WARN
            });
        }
    } catch (error) {
        Logger.log({
            message: `cron lock '${name}' release failed (TTL will reclaim): ${(error as Error).message}`,
            event: 'cqlCronLock.release.unknown',
            category: LogCategory.WARN
        });
    }
};
