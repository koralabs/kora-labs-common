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
 *  - this box is the only declared-online box: explicit LOCAL_SERIAL / LOCAL_QUORUM;
 *  - opted-in lock names require an arbiter grant AND a token-owned local CQL row for
 *    either declared or automatic solo operation; they never use an independent local mutex.
 *  - automatic eligibility requires definite SERIAL UNAVAILABLE, or unreachable DC1 confirmed
 *    by a local coordinator's SERIAL UNAVAILABLE. Ambiguous outcomes never authorize solo.
 *
 * The Durable Object drains 300s for every new episode, grants 600s, and retires old tokens.
 * A run starts only with >300s grant lifetime remaining (the Fn hard-kill maximum). A healed
 * SERIAL read retires the grant without deleting its local token row, preserving in-flight work.
 *
 * The row TTL recovers crashed holders. Unique per-invocation owner tokens prevent
 * overlapping ticks on one box from mistaking node identity for lock ownership.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { errors, types } from 'cassandra-driver';
import { LogCategory, Logger } from '../logger';
import { createCqlExecutor, LOCAL_COORDINATOR_PROFILE } from './cqlClient';
import { arbiterOwner, ARBITER_LEASE_MS, createCronArbiter, CronArbiter, MAX_SOLO_RUN_MS } from './arbiter';

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
    | { status: 'held'; owner?: string }
    | { status: 'peerUnavailable'; token: string; message: string }
    | { status: 'unavailable'; message: string; coordinatorUnreachable?: true };

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
 * An UNAVAILABLE response proves this proposal was not accepted, NOT that the other DC cannot run.
 * Only an arbiter grant plus the local token row authorizes automatic solo. The driver's default retry
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
        if (row?.owner !== token) return arbiterOwner(row?.owner)
            ? { status: 'held', owner: String(row?.owner) } : { status: 'held' };

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
            if (read.owner && read.owner !== token) return arbiterOwner(read.owner)
                ? { status: 'held', owner: read.owner } : { status: 'held' };
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
        return { status: 'unavailable', message, ...(isCoordinatorUnreachableError(error) ? { coordinatorUnreachable: true as const } : {}) };
    }
};

/** No coordinator accepted a query; never reinterpret an ambiguous driver timeout as peer loss. */
export const isCoordinatorUnreachableError = (error: unknown): boolean => {
    if (!(error instanceof errors.NoHostAvailableError) || isUnknownOutcomeError(error)) return false;
    return Object.values(error.innerErrors ?? {}).every((inner: unknown) => {
        // Driver 4.9/4.10 RequestHandler/PrepareHandler use this literal, not an Error, when
        // the pinned host is marked DOWN. No query was dispatched to that host.
        if (inner === 'Host considered as DOWN') return true;
        if (inner instanceof errors.ResponseError || inner instanceof errors.OperationTimedOutError) return false;
        const code = (inner as NodeJS.ErrnoException)?.code;
        return ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET'].includes(code ?? '');
    });
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

export interface AcquireOptions {
    leaseMs?: number;
    /** Applies to every caller of this lock name, including non-cron callers. Fn lifetime must be <=300s. */
    arbiter?: boolean;
}

/** Complete admission lifecycle; injected boundaries exercise the real CQL and HTTP behavior in the lab. */
export const acquireCoordinatedWithExecutor = async (
    executor: CqlExecutor,
    name: string,
    offline: string | null | undefined,
    topology: CronLockTopology,
    options: { leaseMs?: number; arbiter?: CronArbiter; now?: () => number } = {}
): Promise<AcquireResult> => {
    const now = options.now ?? (() => performance.now());
    const mode = resolveMode(parseOffline(offline), topology);
    if (mode === 'standDown') return { status: 'held' };
    const normalToken = createToken(topology);
    if (mode !== 'localSerial' || !options.arbiter) {
        let normal = await acquireWithExecutor(executor, name, offline, topology, normalToken, options.leaseMs);
        if (normal.status === 'unavailable' && normal.coordinatorUnreachable && topology.localDataCenter !== 'kora-dc1' && options.arbiter) {
            // This is still SERIAL/QUORUM. Only a definite UNAVAILABLE from the local coordinator
            // proves peer loss; arbitrary NoHostAvailable, timeouts and local failures never authorize solo.
            try {
                const probe = await executor.execute(`SELECT owner FROM ${KEYSPACE}.${LOCK_TABLE} WHERE name = ?`,
                    [scopeName(name, topology)], { prepare: true, consistency: types.consistencies.serial,
                        executionProfile: LOCAL_COORDINATOR_PROFILE });
                const owner = (probe.rows[0] as Record<string, unknown> | undefined)?.owner;
                normal = typeof owner === 'string' ? { status: 'held', ...(arbiterOwner(owner) ? { owner } : {}) }
                    : { status: 'unavailable', message: 'Pinned coordinator unreachable, but the local SERIAL read confirms a responsive peer quorum' };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                normal = isPeerUnavailableError(error) ? { status: 'peerUnavailable', token: normalToken, message }
                    : { status: 'unavailable', message };
            }
        }
        if (normal.status === 'acquired' || normal.status === 'held') {
            if (normal.status === 'held' && normal.owner && options.arbiter) {
                // A SERIAL result proves the link healed. Retire the solo episode, NOT its CQL row:
                // that token continues protecting any in-flight Fn until its conditional release/TTL.
                await options.arbiter.request('release', { network: topology.network, name,
                    ownerBox: arbiterOwner(normal.owner)!, token: normal.owner });
            }
            return normal;
        }
        if (normal.status !== 'peerUnavailable' || !options.arbiter) {
            return normal.status === 'peerUnavailable' ? { status: 'unavailable', message: normal.message } : normal;
        }
    }
    if (!options.arbiter) throw new Error('An arbiter is required for automatic solo admission');
    const token = `${topology.nodeCode}:arbiter:${randomUUID()}`;
    const identity = { network: topology.network, name, ownerBox: topology.nodeCode, token };
    const grant = await options.arbiter.request('acquire', identity);
    if (grant.status !== 'granted') return { status: 'held' };
    const localOffline = topology.mintNodes.filter(node => node !== topology.nodeCode).join(',');
    const finishUnusedGrant = async (): Promise<void> => {
        await options.arbiter!.request('release', identity);
    };
    if (grant.deadline - now() <= MAX_SOLO_RUN_MS) {
        await finishUnusedGrant();
        return { status: 'unavailable', message: 'Arbiter grant has insufficient remaining Fn lifetime' };
    }
    // Both locks are required. In particular this row prevents a healed SERIAL contender from
    // starting while the solo Fn is alive; the arbiter alone cannot bridge the CQL handoff.
    const local = await acquireWithExecutor(executor, name, localOffline, topology, token, ARBITER_LEASE_MS);
    if (local.status === 'acquired' && grant.deadline - now() > MAX_SOLO_RUN_MS) return local;
    if (local.status === 'acquired') await releaseWithExecutor(executor, name, token, localOffline, topology);
    await finishUnusedGrant();
    return local.status === 'held' ? { status: 'held' } : { status: 'unavailable', message: 'Arbiter-authorized local CQL acquisition failed or exceeded the Fn start budget' };
};

export const acquire = async (name: string, offline?: string | null, options: AcquireOptions = {}): Promise<AcquireResult> => {
    try {
        const topology = resolveTopology();
        const executor = getClient(topology);
        if (resolveMode(parseOffline(offline), topology) === 'standDown') return { status: 'held' };
        await ensureSchema(executor);
        const result = await acquireCoordinatedWithExecutor(executor, name, offline, topology, {
            leaseMs: options.leaseMs, ...(options.arbiter ? { arbiter: createCronArbiter() } : {})
        });
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

export const releaseCoordinatedWithExecutor = async (
    executor: CqlExecutor,
    name: string,
    token: string,
    offline: string | null | undefined,
    topology: CronLockTopology,
    arbiter?: CronArbiter
): Promise<ReleaseResult> => {
    const ownerBox = arbiterOwner(token);
    const standDown = resolveMode(parseOffline(offline), topology) === 'standDown';
    const localOffline = ownerBox && !standDown ? topology.mintNodes.filter(node => node !== topology.nodeCode).join(',') : offline;
    const result = await releaseWithExecutor(executor, name, token, localOffline, topology);
    if (ownerBox) {
        if (!arbiter) throw new Error('Arbiter token release requires the arbiter client');
        await arbiter.request('release', { network: topology.network, name, ownerBox, token });
    }
    return result;
};

export const release = async (name: string, token: string, offline?: string | null): Promise<void> => {
    try {
        const topology = resolveTopology();
        const result = await releaseCoordinatedWithExecutor(getClient(topology), name, token, offline, topology,
            arbiterOwner(token) ? createCronArbiter() : undefined);
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
