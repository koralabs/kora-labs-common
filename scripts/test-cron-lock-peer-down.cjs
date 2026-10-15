// Local-only companion to test-cron-lock-coordinator.cjs, after stopping exactly one LAB container.
// Usage: node scripts/test-cron-lock-peer-down.cjs <surviving-dc: 1|2>
const assert = require('node:assert/strict');
const { types } = require('cassandra-driver');
const { createCqlExecutor } = require('../lib/cronLock/cqlClient');
const { acquireWithExecutor, releaseWithExecutor } = require('../lib/cronLock/cqlCronLock');
const dc = Number(process.argv[2]);
assert([1,2].includes(dc));
const nodeCode = dc === 1 ? 'sfo' : 'rdm';
const offline = dc === 1 ? 'rdm' : 'sfo';
const topology = {network:'a1-local-lab', nodeCode, mintNodes:['sfo','rdm'], localDataCenter:`kora-dc${dc}`, contactPoints:[`172.20.0.${dc+1}`]};
const executor = createCqlExecutor(topology);
(async () => {
    try {
        const name = `peer-down-${Date.now()}`;
        // Invariant: losing either lab replica cannot grant an all-online lock.
        // Failure caught: routing to a coordinator accidentally downgraded SERIAL/QUORUM.
        // Negative control: changing normal-mode consistency to LOCAL_SERIAL/LOCAL_QUORUM grants and fails here.
        const normal = await acquireWithExecutor(executor, name, 'none', topology, `${nodeCode}:normal`, 30000);
        assert(['unavailable','peerUnavailable'].includes(normal.status), JSON.stringify(normal));
        // Edge: explicit operator-declared solo mode must still route to the remaining local DC.
        const solo = await acquireWithExecutor(executor, name, offline, topology, `${nodeCode}:solo`, 30000);
        assert.deepEqual(solo, {status:'acquired',token:`${nodeCode}:solo`});
        assert.deepEqual(await releaseWithExecutor(executor,name,solo.token,offline,topology),{status:'released'});
        const read = await executor.execute('SELECT owner FROM kora_locks.cron_lock WHERE name=?',[`a1-local-lab:${name}`],{prepare:true,consistency:types.consistencies.localSerial});
        assert.equal(read.rows.length,0);
        assert.equal(read.info.queriedHost,`172.20.0.${dc+1}:9042`);
        console.log(JSON.stringify({survivingDC:dc,normal:normal.status,solo:solo.status,released:true,coordinator:read.info.queriedHost}));
    } finally {await executor.shutdown();}
})().catch(error=>{console.error(error);process.exitCode=1;});
