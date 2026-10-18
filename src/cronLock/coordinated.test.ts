import { Client, errors, types } from 'cassandra-driver';
import { performance } from 'node:perf_hooks';
import { CronArbiter, ArbiterIdentity, ArbiterDecision } from './arbiter';
import { acquire, acquireCoordinatedWithExecutor, releaseCoordinatedWithExecutor, CqlExecutor, CronLockTopology } from './cqlCronLock';
import { LOCAL_COORDINATOR_PROFILE } from './cqlClient';

const topology: CronLockTopology = { network: 'preview', nodeCode: 'rdm', mintNodes: ['sfo', 'rdm'], localDataCenter: 'kora-dc2', contactPoints: ['127.0.0.1'] };
const unavailable = () => Object.assign(Object.create(errors.ResponseError.prototype), {
    code: types.responseErrorCodes.unavailableException, message: 'peer unreachable'
});
const noCoordinator = () => new errors.NoHostAvailableError({ 'dc1:9042': Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });
const arbiter = (decision: () => ArbiterDecision = () => ({ status: 'granted', deadline: performance.now() + 600000 })) => {
    const requests: { action: string; identity: ArbiterIdentity }[] = [];
    const boundary: CronArbiter = { async request(action, identity) {
        requests.push({ action, identity });
        return action === 'release' ? { status: 'released' } : decision();
    } };
    return { boundary, requests };
};

// Invariant: a healthy global mutex never consumes arbiter quota; all callers use the same normal row.
// Failure caught: new coordination adds a mandatory external dependency on ordinary days.
// Negative control: moving arbiter acquisition ahead of SERIAL makes the empty-request assertion fail.
it.each(['lock.mintPaidSessionsLock', 'lock.updateActiveSessionsLock'])('keeps healthy %s SERIAL-only', async name => {
    const authority = arbiter();
    const executor: CqlExecutor = { async execute(_query, _params, options) {
        expect(options!.serialConsistency).toBe(types.consistencies.serial);
        expect(options!.consistency).toBe(types.consistencies.quorum);
        return { rows: [{ '[applied]': true }] };
    } };
    expect(await acquireCoordinatedWithExecutor(executor, name, 'none', topology, { arbiter: authority.boundary })).toMatchObject({ status: 'acquired' });
    expect(authority.requests).toEqual([]);
});

// Invariant: disabling AUTOMATIC solo does not remove the human-declared offline override.
// Failure caught: staging arbiter:false changes /mintserver semantics or accidentally contacts the DO.
// Negative control: route false through SERIAL or through the arbiter and persisted ownership/fetch assertions fail.
it.each([undefined, false])('preserves explicit sole-online LOCAL_SERIAL when arbiter is %s', async enabled => {
    const env = { ...process.env };
    Object.assign(process.env, { NETWORK: 'preview', KORA_NODE_CODE: 'rdm', KORA_MINT_NODES: 'sfo,rdm',
        KORA_SCYLLA_DC: 'kora-dc2', KORA_CQL_CONTACT_POINTS: '127.0.0.1' });
    const rows = new Map<string, string>();
    const fetcher = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(Client.prototype, 'execute').mockImplementation((async (query: string, params: unknown[], options: Record<string, unknown>) => {
        if (query.startsWith('SELECT table_name')) return { rows: [{ table_name: 'cron_lock' }] };
        expect(options.serialConsistency).toBe(types.consistencies.localSerial);
        expect(options.consistency).toBe(types.consistencies.localQuorum);
        rows.set(String(params[0]), String(params[1]));
        return { rows: [{ '[applied]': true }] };
    }) as never);
    try {
        const result = await acquire('lock.mintPaidSessionsLock', 'sfo', enabled === undefined ? {} : { arbiter: enabled });
        expect(result.status).toBe('acquired');
        expect(rows.get('preview:lock.mintPaidSessionsLock')).toBe(result.status === 'acquired' ? result.token : 'must acquire');
        expect(fetcher).not.toHaveBeenCalled();
    } finally { process.env = env; jest.restoreAllMocks(); }
});

// Invariant: enabled arbiter authority is required even for a per-DC explicit offline declaration.
// Failure caught: an isolated peer misses /mintserver and runs concurrently with a local override.
// Negative control: reuse the false/omitted override for true and localWrites becomes one while draining.
it('does not bypass an enabled arbiter on an explicit sole-online box', async () => {
    const authority = arbiter(() => ({ status: 'draining' }));
    let localWrites = 0;
    const executor: CqlExecutor = { async execute() { localWrites++; return { rows: [{ '[applied]': true }] }; } };
    expect(await acquireCoordinatedWithExecutor(executor, 'lock', 'sfo', topology, { arbiter: authority.boundary })).toEqual({ status: 'held' });
    expect(localWrites).toBe(0);
    expect(authority.requests.map(x => x.action)).toEqual(['acquire']);
});

// Invariant: every holder of a name, including wallet rebalance, needs BOTH the grant and local CQL row.
// Failure caught: arbiter permission alone bypasses an existing CQL holder or old solo runs on both DCs.
// Negative control: skipping the local conditional write makes the returned token absent from rows.
it('protects a rebalance holder under partition with an arbiter token in the same CQL row', async () => {
    const authority = arbiter();
    const rows = new Map<string, string>();
    const executor: CqlExecutor = { async execute(_query, params = [], options) {
        if (options!.serialConsistency === types.consistencies.serial) throw unavailable();
        expect(options!.serialConsistency).toBe(types.consistencies.localSerial);
        const [name, token] = params as string[];
        if (rows.has(name)) return { rows: [{ '[applied]': false, owner: rows.get(name) }] };
        rows.set(name, token);
        return { rows: [{ '[applied]': true }] };
    } };
    const result = await acquireCoordinatedWithExecutor(executor, 'lock.mintPaidSessionsLock', 'none', topology, { arbiter: authority.boundary });
    expect(result.status).toBe('acquired');
    expect(rows.get('preview:lock.mintPaidSessionsLock')).toBe(result.status === 'acquired' ? result.token : 'must acquire');
    expect(authority.requests.map(x => x.action)).toEqual(['acquire']);
    expect(authority.requests[0].identity.token).toMatch(/^rdm:arbiter:/);
});

// Invariant: coordinator loss alone is insufficient; a local SERIAL/QUORUM probe must prove peer loss.
// Failure caught: pinned DC1 loss pauses RDM forever, or an ambiguous local timeout authorizes solo.
// Negative control: remove the profile override or accept timeouts and the acquisition outcome changes.
it.each(['unavailable', 'timeout'])('confirms DC1 loss locally before arbiter eligibility: %s', async outcome => {
    const authority = arbiter();
    let localProofs = 0;
    const executor: CqlExecutor = { async execute(_query, _params, options) {
        if (options!.serialConsistency === types.consistencies.localSerial) return { rows: [{ '[applied]': true }] };
        if (options!.executionProfile !== LOCAL_COORDINATOR_PROFILE) throw noCoordinator();
        localProofs++;
        if (outcome === 'unavailable') throw unavailable();
        throw new errors.OperationTimedOutError('unknown outcome');
    } };
    const result = await acquireCoordinatedWithExecutor(executor, 'lock.mintPaidSessionsLock', 'none', topology, { arbiter: authority.boundary });
    expect(localProofs).toBeGreaterThan(0);
    expect(result.status).toBe(outcome === 'unavailable' ? 'acquired' : 'unavailable');
    expect(authority.requests.length).toBe(outcome === 'unavailable' ? 1 : 0);
});

// Invariant: eligibility confirmation must not create a normal lock on an alternate coordinator.
// Failure caught: a healthy-peer local probe INSERT creates ownership whose release still routes to inaccessible DC1.
// Negative control: change SELECT to INSERT and the read-only assertion fails.
it('does not mutate ownership or arbitrate when only the app-to-DC1 route is down', async () => {
    const authority = arbiter();
    let localReads = 0;
    const executor: CqlExecutor = { async execute(query, _params, options) {
        if (options!.executionProfile !== LOCAL_COORDINATOR_PROFILE) throw noCoordinator();
        expect(query).toMatch(/^SELECT owner/);
        expect(options!.consistency).toBe(types.consistencies.serial);
        localReads++;
        return { rows: [] };
    } };
    const result = await acquireCoordinatedWithExecutor(executor, 'lock', 'none', topology, { arbiter: authority.boundary });
    expect(result).toMatchObject({ status: 'unavailable', message: expect.stringContaining('responsive peer quorum') });
    expect(localReads).toBe(1);
    expect(authority.requests).toEqual([]);
});

// Invariant: actual driver DOWN sentinels are eligible only after local SERIAL proves UNAVAILABLE.
// Failure caught: real 4.9.0 innerErrors contains a plain string, so the RDM survivor never consulted DO.
// Negative control: remove the exact sentinel classification and this returns unavailable, not held.
it.each(['Host considered as DOWN', 'arbitrary configuration failure'])('classifies the driver sentinel %s without broadening unknown failures', async sentinel => {
    const authority = arbiter(() => ({ status: 'draining' }));
    let localProofs = 0;
    const executor: CqlExecutor = { async execute(_query, _params, options) {
        if (options!.executionProfile === LOCAL_COORDINATOR_PROFILE) { localProofs++; throw unavailable(); }
        throw new errors.NoHostAvailableError({ 'dc1:9042': sentinel } as never);
    } };
    const result = await acquireCoordinatedWithExecutor(executor, 'lock', 'none', topology, { arbiter: authority.boundary });
    const known = sentinel === 'Host considered as DOWN';
    expect(result.status).toBe(known ? 'held' : 'unavailable');
    expect(localProofs).toBe(known ? 1 : 0);
    expect(authority.requests.length).toBe(known ? 1 : 0);
});

// Invariant: a grant must leave a full Fn lifetime after local admission, without waiting through drain.
// Failure caught: a run starts within the last 300s or after slow CQL consumes its remaining budget.
// Negative control: remove either deadline check and the corresponding case grants work.
it.each(['short-before', 'short-after', 'draining', 'held'])('does not run on %s authority', async state => {
    const deadline = 600000;
    let now = 0;
    const authority = arbiter(() => state === 'draining' || state === 'held'
        ? { status: state } : { status: 'granted', deadline: state === 'short-before' ? 100 : deadline });
    let localWrites = 0;
    let deletes = 0;
    const executor: CqlExecutor = { async execute(query, _params, options) {
        if (options!.serialConsistency === types.consistencies.serial) throw unavailable();
        if (query.startsWith('DELETE')) { deletes++; return { rows: [{ '[applied]': true }] }; }
        localWrites++;
        if (state === 'short-after') now = 600001;
        return { rows: [{ '[applied]': true }] };
    } };
    {
        const result = await acquireCoordinatedWithExecutor(executor, 'lock', 'none', topology, { arbiter: authority.boundary, now: () => now });
        expect(result.status).not.toBe('acquired');
        if (state === 'draining' || state === 'held') {
            expect(localWrites).toBe(0);
            expect(authority.requests.map(x => x.action)).toEqual(['acquire']);
        } else {
            expect(authority.requests.map(x => x.action)).toEqual(['acquire', 'release']);
        }
        if (state === 'short-before') expect(localWrites).toBe(0);
        if (state === 'short-after') { expect(localWrites).toBe(1); expect(deletes).toBe(1); }
    }
});

// Invariant: heal ends the grant episode but cannot free the running solo holder's CQL token.
// Failure caught: a recovered normal acquisition clears the live row or reuses its grant on partition #2.
// Negative control: deleting the CQL row on heal fails the preserved owner assertion.
it('retires the exact grant on healed SERIAL without deleting the live token row', async () => {
    const token = 'sfo:arbiter:12345678-1234-1234-1234-123456789abc';
    const authority = arbiter();
    let queries = 0;
    const executor: CqlExecutor = { async execute(query) {
        queries++;
        expect(query).toMatch(/^INSERT/);
        return { rows: [{ '[applied]': false, owner: token }] };
    } };
    expect(await acquireCoordinatedWithExecutor(executor, 'lock', 'none', topology, { arbiter: authority.boundary })).toEqual({ status: 'held', owner: token });
    expect(queries).toBe(1);
    expect(authority.requests).toEqual([{ action: 'release', identity: { network: 'preview', name: 'lock', ownerBox: 'sfo', token } }]);
});

// Invariant: stale releases cannot remove another acquisition's CQL row or external grant.
// Failure caught: choosing local release from token shape degenerates into an unconditional clear.
// Negative control: remove either conditional token check and the live-owner assertions fail.
it('releases only the exact arbiter acquisition across both stores', async () => {
    const live = 'rdm:arbiter:12345678-1234-1234-1234-123456789abc';
    const stale = 'rdm:arbiter:87654321-1234-1234-1234-123456789abc';
    let row: string | undefined = live;
    let grant: string | undefined = live;
    const executor: CqlExecutor = { async execute(query, params = [], options) {
        expect(query).toMatch(/^DELETE.*IF owner =/);
        expect(options!.serialConsistency).toBe(types.consistencies.localSerial);
        const applied = row === params[1];
        if (applied) row = undefined;
        return { rows: [{ '[applied]': applied }] };
    } };
    const authority: CronArbiter = { async request(action, identity) {
        expect(action).toBe('release');
        if (grant !== identity.token) return { status: 'held' };
        grant = undefined;
        return { status: 'released' };
    } };
    expect(await releaseCoordinatedWithExecutor(executor, 'lock', stale, 'none', topology, authority)).toEqual({ status: 'released' });
    expect(row).toBe(live);
    expect(grant).toBe(live);
    expect(await releaseCoordinatedWithExecutor(executor, 'lock', live, 'none', topology, authority)).toEqual({ status: 'released' });
    expect(row).toBeUndefined();
    expect(grant).toBeUndefined();
});

it('keeps operator offline stand-down and never asks the arbiter on that box', async () => {
    const authority = arbiter();
    let queries = 0;
    const executor: CqlExecutor = { async execute() { queries++; throw new Error('offline must not query'); } };
    expect(await acquireCoordinatedWithExecutor(executor, 'lock', 'rdm', topology, { arbiter: authority.boundary })).toEqual({ status: 'held' });
    expect(queries).toBe(0);
    expect(authority.requests).toEqual([]);
});
