import { types } from 'cassandra-driver';
import { acquireCoordinatedWithExecutor, releaseCoordinatedWithExecutor, CqlExecutor, CronLockTopology } from './cqlCronLock';
import { CronArbiter } from './arbiter';

const topology: CronLockTopology = { network: 'preview', nodeCode: 'rdm', mintNodes: ['sfo', 'rdm'], localDataCenter: 'kora-dc2', contactPoints: ['127.0.0.1'] };
const table = (failWrite = false, malformed = false) => {
    const locks = new Map<string, string>();
    let vector = { sfo: 9000, rdm: 1000 };
    let version = BigInt(9000000);
    const executor: CqlExecutor = { async execute(query, params = [], options = {}) {
        if (query.startsWith('SELECT owner, writetime')) {
            expect(options.consistency).toBe(types.consistencies.localOne);
            return { rows: [{ owner: malformed ? '{broken' : JSON.stringify(vector), version: types.Long.fromString(String(version)) }] };
        }
        if (query.includes('USING TIMESTAMP')) {
            expect(options.consistency).toBe(types.consistencies.quorum);
            expect(String(params[0])).toBe('preview:!normal-success:lock.mintPaidSessionsLock');
            if (failWrite) throw new Error('evidence QUORUM failed');
            // Real CQL is last-write-wins: a skewed behind-clock timestamp must NOT overwrite.
            const incoming = BigInt(String(params[2]));
            if (incoming > version) { vector = JSON.parse(String(params[1])); version = incoming; }
            return { rows: [] };
        }
        const [key, token] = params.map(String);
        if (query.startsWith('INSERT')) {
            expect(options.serialConsistency).toBe(types.consistencies.serial);
            if (locks.has(key)) return { rows: [{ '[applied]': false, owner: locks.get(key) }] };
            locks.set(key, token); return { rows: [{ '[applied]': true }] };
        }
        if (query.startsWith('DELETE')) {
            const applied = locks.get(key) === token;
            if (applied) locks.delete(key);
            return { rows: [{ '[applied]': applied }] };
        }
        throw new Error(query);
    } };
    return { executor, locks, vector: () => vector, version: () => version };
};

// Invariant: a normal holder's causal heal evidence survives clock rollback and opposite-box skew.
// Failure caught: own logical time decreases or CQL silently discards a behind-clock writer's update.
// Negative control: using wall clock alone in either payload or USING TIMESTAMP fails these exact values.
it('preserves peer evidence and advances both logical and CQL clocks before allowing work', async () => {
    const db = table();
    let externalRequests = 0;
    const arbiter: CronArbiter = { async request() { externalRequests++; throw new Error('healthy must not call DO'); } };
    for (const [wall, logical, timestamp] of [[5, 1001, 9000001], [4, 1002, 9000002]]) {
        const result = await acquireCoordinatedWithExecutor(db.executor, 'lock.mintPaidSessionsLock', 'none', topology, { arbiter, wallNow: () => wall });
        expect(result.status).toBe('acquired');
        expect(db.vector()).toEqual({ sfo: 9000, rdm: logical });
        expect(db.version()).toBe(BigInt(timestamp));
        expect(db.locks.size).toBe(1);
        if (result.status === 'acquired') {
            expect(await releaseCoordinatedWithExecutor(db.executor, 'lock.mintPaidSessionsLock', result.token, 'none', topology, arbiter)).toEqual({ status: 'released' });
        }
        expect(db.locks.size).toBe(0);
    }
    expect(externalRequests).toBe(0);
});

// Invariant: no job may start until its normal-success vector is acknowledged by both DCs.
// Failure caught: failed/malformed evidence leaves a running normal holder invisible to the next partition.
// Negative control: swallowing the metadata failure returns acquired and/or leaves the CQL lock in place.
it.each(['write-failure', 'malformed-evidence'])('releases its token and stands down on %s', async failure => {
    const db = table(failure === 'write-failure', failure === 'malformed-evidence');
    let externalRequests = 0;
    const arbiter: CronArbiter = { async request() { externalRequests++; return { status: 'granted', deadline: 999999999 }; } };
    const result = await acquireCoordinatedWithExecutor(db.executor, 'lock.mintPaidSessionsLock', 'none', topology, { arbiter });
    expect(result).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Normal-success evidence was not confirmed') });
    expect(db.locks.size).toBe(0);
    expect(db.vector()).toEqual({ sfo: 9000, rdm: 1000 });
    expect(externalRequests).toBe(0);
});
