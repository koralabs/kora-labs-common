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
 *  - an undeclared peer outage: the caller normally fails closed. StateData may
 *    use its DC-local fallback only for mintPaidSessions and only after a definite
 *    CQL UNAVAILABLE response (never after a timeout or unknown failure).
 *
 * The row TTL recovers crashed holders. Unique per-invocation owner tokens prevent
 * overlapping ticks on one box from mistaking node identity for lock ownership.
 */
import { randomUUID } from 'node:crypto';
import { Client, errors, types } from 'cassandra-driver';
import { LogCategory, Logger } from '../logger';

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

let client: Client | null = null;
let clientTopologyKey = '';
let ensured = false;

const getClient = (topology: CronLockTopology): Client => {
    const topologyKey = JSON.stringify([topology.contactPoints, topology.localDataCenter]);
    if (!client || clientTopologyKey !== topologyKey) {
        client = new Client({
            contactPoints: topology.contactPoints,
            localDataCenter: topology.localDataCenter,
            socketOptions: { connectTimeout: 8000, readTimeout: 12000 }
        });
        clientTopologyKey = topologyKey;
        ensured = false;
    }
    return client;
};

const ensureSchema = async (executor: CqlExecutor): Promise<void> => {
    if (ensured) return;
    await executor.execute(
        `CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE} WITH replication = ` +
            `{'class':'NetworkTopologyStrategy','kora-dc1':1,'kora-dc2':1}`
    );
    await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${KEYSPACE}.${LOCK_TABLE} (name text PRIMARY KEY, owner text, acquired_at timestamp)`
    );
    ensured = true;
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

/** Only an UNAVAILABLE response proves that no SERIAL proposal was accepted. */
export const isPeerUnavailableError = (error: unknown): boolean =>
    error instanceof errors.ResponseError && error.code === types.responseErrorCodes.unavailableException;

/** A write timeout leaves an LWT's outcome unknown: the proposal may or may not have been applied. */
export const isWriteTimeoutError = (error: unknown): boolean =>
    error instanceof errors.ResponseError && error.code === types.responseErrorCodes.writeTimeout;

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

    try {
        const result = await executor.execute(
            `INSERT INTO ${KEYSPACE}.${LOCK_TABLE} (name, owner, acquired_at) VALUES (?, ?, ?) IF NOT EXISTS USING TTL ${leaseSeconds(lease)}`,
            [key, token, new Date()],
            { prepare: true, serialConsistency, consistency }
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (row?.['[applied]'] === true) return { status: 'acquired', token };
        if (row?.owner !== token) return { status: 'held' };

        const refresh = await executor.execute(
            `UPDATE ${KEYSPACE}.${LOCK_TABLE} USING TTL ${leaseSeconds(lease)} SET owner = ?, acquired_at = ? WHERE name = ? IF owner = ?`,
            [token, new Date(), key, token],
            { prepare: true, serialConsistency, consistency }
        );
        const refreshRow = refresh.rows[0] as Record<string, unknown> | undefined;
        return refreshRow?.['[applied]'] === true ? { status: 'acquired', token } : { status: 'held' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mode === 'serial' && isPeerUnavailableError(error)) {
            return { status: 'peerUnavailable', token, message };
        }
        if (isWriteTimeoutError(error)) {
            // The LWT timed out: it may have been applied WITH OUR TOKEN, in which case nobody (not even
            // us) could run until the lease expired. A read at the same serial consistency completes any
            // in-flight Paxos round, so it tells us the real owner.
            const owner = await readOwner(executor, key, serialConsistency);
            if (owner === token) return { status: 'acquired', token };
            if (owner) return { status: 'held' };
        }
        return { status: 'unavailable', message };
    }
};

/** The lock's owner as a linearizable (serial) read sees it; undefined when absent or unreadable. */
const readOwner = async (executor: CqlExecutor, key: string, serialConsistency: number): Promise<string | undefined> => {
    try {
        const result = await executor.execute(`SELECT owner FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ?`, [key], { prepare: true, consistency: serialConsistency });
        const owner = (result.rows[0] as Record<string, unknown> | undefined)?.owner;
        return typeof owner === 'string' ? owner : undefined;
    } catch {
        return undefined;
    }
};

export const acquire = async (name: string, offline?: string | null, options: { leaseMs?: number } = {}): Promise<AcquireResult> => {
    try {
        const topology = resolveTopology();
        const executor = getClient(topology);
        await ensureSchema(executor);
        const result = await acquireWithExecutor(executor, name, offline, topology, undefined, options.leaseMs);
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

/** Release only the exact acquisition token owned by this invocation. */
export const release = async (name: string, token: string, offline?: string | null): Promise<void> => {
    try {
        const topology = resolveTopology();
        const mode = resolveMode(parseOffline(offline), topology);
        if (mode === 'standDown') return;
        const serialConsistency = mode === 'localSerial' ? types.consistencies.localSerial : types.consistencies.serial;
        const consistency = mode === 'localSerial' ? types.consistencies.localQuorum : types.consistencies.quorum;
        await getClient(topology).execute(
            `DELETE FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ? IF owner = ?`,
            [scopeName(name, topology), token],
            { prepare: true, serialConsistency, consistency }
        );
    } catch (error) {
        Logger.log({
            message: `cron lock '${name}' release best-effort failed (TTL will reclaim): ${(error as Error).message}`,
            event: 'cqlCronLock.release.softfail',
            category: LogCategory.INFO
        });
    }
};
