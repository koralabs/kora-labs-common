// Local-only integration test. Never run in Actions or against production.
// Two Scylla 6.2 DCs (kora-dc1/kora-dc2), RF=1 each, 25ms one-way delay per node.
// Usage after npm run build: node scripts/test-cron-lock-coordinator.cjs <dc1-ip> <dc2-ip>
const assert = require('node:assert/strict');
const { Client, types } = require('cassandra-driver');
const { createCqlExecutor } = require('../lib/cronLock/cqlClient');
const { acquireWithExecutor, releaseWithExecutor } = require('../lib/cronLock/cqlCronLock');

const ips = process.argv.slice(2);
assert.equal(ips.length, 2, 'Supply two isolated lab container IPs');
assert(ips.every(ip => /^172\.20\.0\.[23]$/.test(ip)), 'This test is restricted to the documented isolated Docker lab');
const topologies = ips.map((ip, i) => ({
    network: 'a1-local-lab', nodeCode: i === 0 ? 'sfo' : 'rdm', mintNodes: ['sfo', 'rdm'],
    localDataCenter: `kora-dc${i + 1}`, contactPoints: [ip]
}));
const setup = new Client({ contactPoints: [ips[0]], localDataCenter: 'kora-dc1' });
let databaseErrors = 0;
const executors = topologies.map(topology => {
    const executor = createCqlExecutor(topology);
    return {
        shutdown: () => executor.shutdown(),
        async execute(...args) {
            try { return await executor.execute(...args); }
            catch (error) { databaseErrors++; throw error; }
        }
    };
});
const namespace = `coordinator-${Date.now()}`;

(async () => {
    try {
        await setup.execute("CREATE KEYSPACE IF NOT EXISTS kora_locks WITH replication={'class':'NetworkTopologyStrategy','kora-dc1':1,'kora-dc2':1} AND tablets={'enabled':false}");
        await setup.execute('CREATE TABLE IF NOT EXISTS kora_locks.cron_lock(name text PRIMARY KEY, owner text, acquired_at timestamp)');
        const coordinators = new Set();
        // Invariant: competing boxes yield one owner and one held, never uncertainty or double ownership.
        // Failure caught: local-DC routing produces partial Paxos acceptances reported as SERIAL timeouts.
        // Negative control: reverting createCqlExecutor to the original local-DC Client causes this run to fail.
        for (let n = 0; n < 100; n++) {
            const name = `${namespace}-${n}`;
            const tokens = [`sfo:${name}`, `rdm:${name}`];
            const results = await Promise.all(executors.map((executor, i) =>
                acquireWithExecutor(executor, name, 'none', topologies[i], tokens[i], 30000)));
            assert.deepEqual(results.map(r => r.status).sort(), ['acquired', 'held'], JSON.stringify({n, results}));
            const winner = results.findIndex(r => r.status === 'acquired');
            // A stale/non-owner release must not free another invocation's row.
            assert.deepEqual(await releaseWithExecutor(executors[1-winner], name, tokens[1-winner], 'none', topologies[1-winner]), {status:'released'});
            const read = await executors[1-winner].execute('SELECT owner FROM kora_locks.cron_lock WHERE name=?', [`a1-local-lab:${name}`], {prepare:true, consistency:types.consistencies.serial});
            assert.equal(read.rows[0].owner, tokens[winner]);
            coordinators.add(read.info.queriedHost);
            assert.deepEqual(await releaseWithExecutor(executors[winner], name, tokens[winner], 'none', topologies[winner]), {status:'released'});
            const empty = await executors[winner].execute('SELECT owner FROM kora_locks.cron_lock WHERE name=?', [`a1-local-lab:${name}`], {prepare:true, consistency:types.consistencies.serial});
            assert.equal(empty.rows.length, 0, 'Winner release must remove the row');
        }
        assert.equal(databaseErrors, 0, 'Recovery must not hide contending-coordinator database errors');
        assert.deepEqual([...coordinators], [`${ips[0]}:9042`]);
        // Edge: a declared-offline caller never proposes, even if it shares the coordinator.
        assert.deepEqual(await acquireWithExecutor(executors[0], namespace, 'sfo', topologies[0]), {status:'held'});
        // Invalid topology input remains rejected, not reinterpreted as a one-box grant.
        await assert.rejects(acquireWithExecutor(executors[0], namespace, 'unknown-box', topologies[0]), /unknown mint node/);
        console.log(JSON.stringify({rounds:100, acquired:100, held:100, released:100, preservedOtherOwner:100, databaseErrors, coordinators:[...coordinators]}));
    } finally {
        await Promise.all([setup.shutdown(), ...executors.map(e => e.shutdown())]);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
