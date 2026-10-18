// LOCAL ONLY. Reuses the fixed, isolated two-DC lab and the real infra Worker/SQLite DO fixture.
// Run after npm run build; never in Actions. No ambient CQL/Worker URLs are accepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { Client, types } = require('cassandra-driver');
const { createCqlExecutor, LOCAL_COORDINATOR_PROFILE } = require('../lib/cronLock/cqlClient');
const { createCronArbiter } = require('../lib/cronLock/arbiter');
const { acquireCoordinatedWithExecutor, releaseCoordinatedWithExecutor, acquireWithExecutor } = require('../lib/cronLock/cqlCronLock');
const names = ['incident-lock-proof-dc1', 'incident-lock-proof-dc2'];
const ips = ['172.20.0.2', '172.20.0.3'];
const infra = resolve('../kora-self-hosted-apps');
const namespace = `arbiterLab.${Date.now()}`;
assert(process.argv.slice(2).every(arg => arg === '--normal-handoff-only'));
const normalOnly = process.argv.includes('--normal-handoff-only');
const topologies = ips.map((ip, i) => ({ network: 'preview', nodeCode: i ? 'rdm' : 'sfo',
    mintNodes: ['sfo', 'rdm'], localDataCenter: `kora-dc${i + 1}`, contactPoints: [ip] }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pid = i => {
    const info = JSON.parse(docker('inspect', names[i]))[0];
    assert.equal(info.Config.Image, 'scylladb/scylla:6.2');
    assert.equal(info.NetworkSettings.Networks['a1-lock-lab'].IPAddress, ips[i]);
    assert(info.State.Pid > 1);
    return String(info.State.Pid);
};
const ns = (i, ...args) => execFileSync('sudo', ['-n', 'nsenter', '-t', pid(i), '-n', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const delay = () => { for (let i = 0; i < 2; i++) ns(i, 'tc', 'qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '25ms'); };
const partition = async cut => {
    for (let i = 0; i < 2; i++) {
        const rule = ['OUTPUT', '-d', ips[1-i], '-j', 'DROP'];
        try { ns(i, 'iptables', '-C', ...rule); if (!cut) ns(i, 'iptables', '-D', ...rule); }
        catch (error) { if (cut) ns(i, 'iptables', '-I', ...rule); else if (!String(error.stderr).includes('Bad rule')) throw error; }
    }
    for (let n = 0; n < 30; n++) {
        const statuses = names.map(name => docker('exec', name, 'nodetool', 'status'));
        if (statuses.every((text, i) => new RegExp(`^${cut ? 'DN' : 'UN'} ${ips[1-i].replaceAll('.', '\\.')}`, 'm').test(text))) return;
        await sleep(2000);
    }
    throw new Error(`LAB peers did not reach expected ${cut ? 'partitioned' : 'healed'} gossip state`);
};
await mkdir(resolve('tmp/live-lock/arbiter-lab'), { recursive: true });
const fixture = spawn(process.execPath, [resolve(infra, 'aws-exit/cron-arbiter/test/fixture-server.mjs'),
    '--persist', resolve(infra, `tmp/${namespace}`), '--port', '29780', '--now', '1800000000000'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: fixture.stdout });
const queue = []; let pending;
lines.on('line', text => { const event = JSON.parse(text); if (pending) { const done = pending; pending = undefined; done(event); } else queue.push(event); });
const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { pending = resolve; });
const command = async data => { fixture.stdin.write(`${JSON.stringify(data)}\n`); return next(); };
let clients = [], arbiterCalls = 0, soloWrites = 0, localProofs = 0;
let authority;
const results = {};
try {
    const ready = await next();
    assert.equal(new URL(ready.url).hostname, '127.0.0.1');
    authority = createCronArbiter({ KORA_CRON_ARBITER_URL: ready.url, KORA_CRON_ARBITER_HMAC_SECRET: '1'.repeat(64) }, async (...args) => { arbiterCalls++; return fetch(...args); });
    for (const name of names) docker('start', name);
    await sleep(20000); delay(); await partition(false);
    clients = topologies.map(topology => {
        const real = createCqlExecutor(topology);
        return { shutdown: () => real.shutdown(), execute(query, params, options) {
            if (options?.serialConsistency === types.consistencies.localSerial && query.startsWith('INSERT')) soloWrites++;
            if (options?.executionProfile === LOCAL_COORDINATOR_PROFILE && options.consistency === types.consistencies.serial) {
                assert(query.startsWith('SELECT owner'), 'reachability proof must not write a lock');
                localProofs++;
            }
            return real.execute(query, params, options).catch(error => {
                console.log(JSON.stringify({ phase: 'cql-boundary-error', node: topology.nodeCode,
                    error: error.name, message: error.message,
                    inner: Object.fromEntries(Object.entries(error.innerErrors ?? {}).map(([host, inner]) =>
                        [host, { name: inner.name, code: inner.code, message: inner.message }])) }));
                throw error;
            });
        } };
    });
    const setup = new Client({ contactPoints: [ips[0]], localDataCenter: 'kora-dc1' });
    try {
        await setup.execute("CREATE KEYSPACE IF NOT EXISTS kora_locks WITH replication={'class':'NetworkTopologyStrategy','kora-dc1':1,'kora-dc2':1} AND tablets={'enabled':false}");
        await setup.execute('CREATE TABLE IF NOT EXISTS kora_locks.cron_lock(name text PRIMARY KEY, owner text, acquired_at timestamp)');
    } finally { await setup.shutdown(); }
    const acquire = async (i, name) => {
        try { return await acquireCoordinatedWithExecutor(clients[i], name, 'none', topologies[i], { leaseMs: 600000, arbiter: authority }); }
        catch (error) { return { status: 'unavailable', message: error.message }; }
    };
    const release = (i, name, result) => releaseCoordinatedWithExecutor(clients[i], name, result.token, 'none', topologies[i], authority);
    const serialOwner = async (i, name) => {
        const r = await clients[i].execute('SELECT owner FROM kora_locks.cron_lock WHERE name=?', [`preview:${name}`], { prepare: true, consistency: types.consistencies.serial });
        return r.rows[0]?.owner;
    };
    const normalName = `${namespace}.normalRebalance`;
    const before = arbiterCalls;
    const normal = await Promise.all([acquire(0, normalName), acquire(1, normalName)]);
    assert.deepEqual(normal.map(r => r.status).sort(), ['acquired', 'held']);
    assert.equal(arbiterCalls, before, 'normal operation must never contact arbiter');
    const normalWinner = normal.findIndex(r => r.status === 'acquired');
    await partition(true);
    assert.equal((await acquire(1-normalWinner, normalName)).status, 'held', 'prior SERIAL holder requires drain');
    await command({ advanceMs: 299999 });
    assert.equal((await acquire(1-normalWinner, normalName)).status, 'held');
    await command({ advanceMs: 1 });
    assert.equal((await acquire(1-normalWinner, normalName)).status, 'held', 'a grant cannot bypass the existing normal token row');
    await partition(false);
    assert.equal(await serialOwner(1-normalWinner, normalName), normal[normalWinner].token);
    assert.equal((await release(normalWinner, normalName, normal[normalWinner])).status, 'released');
    results.normalNoArbiter = results.existingNormalHolderPartitionSafe = true;

    if (!normalOnly) {
    // Every holder of this name is protected, including wallet rebalance (not just root-UTxO mint).
    const rebalance = `${namespace}.rebalancePartition`;
    await partition(true);
    assert.deepEqual((await Promise.all([acquire(0, rebalance), acquire(1, rebalance)])).map(r => r.status), ['held', 'held']);
    await command({ advanceMs: 300000 });
    const racing = await Promise.all([acquire(0, rebalance), acquire(1, rebalance)]);
    assert.deepEqual(racing.map(r => r.status).sort(), ['acquired', 'held'], JSON.stringify(racing));
    const winner = racing.findIndex(r => r.status === 'acquired');
    assert.equal((await release(winner, rebalance, racing[winner])).status, 'released');
    results.partitionRebalanceOneWinner = true;
    await partition(false);

    // Two heal directions, repeat partition on the SAME scope, and crashes with a real CQL TTL.
    const crashed = [];
    for (const owner of [0, 1]) {
        const name = `${namespace}.heal${owner}`;
        await partition(true);
        assert.equal((await acquire(owner, name)).status, 'held');
        await command({ advanceMs: 300000 });
        const solo = await acquire(owner, name);
        assert.equal(solo.status, 'acquired', JSON.stringify(solo));
        await partition(false);
        for (const i of [0, 1]) assert.equal((await acquire(i, name)).status, 'held', 'healed SERIAL cannot overlap solo');
        assert.equal(await serialOwner(1-owner, name), solo.token, 'heal must not delete a live solo row');
        assert.equal((await release(owner, name, solo)).status, 'released');
        assert.equal(await serialOwner(1-owner, name), undefined);
        await partition(true);
        const writesBefore = soloWrites;
        assert.equal((await acquire(1-owner, name)).status, 'held', 'partition #2 requires new drain');
        await command({ advanceMs: 299999 });
        assert.equal((await acquire(1-owner, name)).status, 'held');
        assert.equal(soloWrites, writesBefore);
        await command({ advanceMs: 1 });
        const episode2 = await acquire(1-owner, name);
        assert.equal(episode2.status, 'acquired', JSON.stringify(episode2));
        assert.notEqual(episode2.token, solo.token);
        // Crash: no release. DO expiry is not allowed to remove the CQL holder's row.
        const expiresAfter = Date.now() + 610000;
        await partition(false);
        await command({ advanceMs: 600000 });
        assert.equal((await acquire(owner, name)).status, 'held');
        assert.equal(await serialOwner(owner, name), episode2.token);
        crashed.push({ name, owner, expiresAfter });
    }
    results.healBothDirections = results.partition2FreshDrain = results.crashTokenPreserved = true;

    // Expiry owner change during a still-partitioned episode; old holder is modeled crashed/killed.
    await partition(true);
    const expiryName = `${namespace}.expiryOwner`;
    assert.equal((await acquire(0, expiryName)).status, 'held');
    await command({ advanceMs: 300000 });
    const expiredHolder = await acquire(0, expiryName); assert.equal(expiredHolder.status, 'acquired');
    await command({ advanceMs: 600000 });
    assert.equal((await acquire(1, expiryName)).status, 'held', 'new owner must drain after expiry');
    await command({ advanceMs: 299999 }); assert.equal((await acquire(1, expiryName)).status, 'held');
    await command({ advanceMs: 1 });
    const newOwner = await acquire(1, expiryName); assert.equal(newOwner.status, 'acquired', JSON.stringify(newOwner));
    assert.notEqual(newOwner.token, expiredHolder.token);
    assert.equal((await release(1, expiryName, newOwner)).status, 'released');
    results.expiryOwnerChangeFreshDrain = true;

    await command({ fault: 'unavailable' });
    const writesBeforeFailure = soloWrites;
    const denied = await Promise.all([acquire(0, `${namespace}.arbiterDown`), acquire(1, `${namespace}.arbiterDown`)]);
    assert.deepEqual(denied.map(r => r.status), ['unavailable', 'unavailable']);
    assert.equal(soloWrites, writesBeforeFailure);
    await command({ fault: '' });
    results.arbiterDownNeitherRuns = true;

    // Old uncoordinated local strategy's real negative control: two independent local grants.
    const oldName = `${namespace}.oldLocalNegative`;
    const old = await Promise.all([0, 1].map(i => acquireWithExecutor(clients[i], oldName, topologies[i].mintNodes[1-i], topologies[i], `${topologies[i].nodeCode}:old-local`, 10000)));
    assert.deepEqual(old.map(r => r.status), ['acquired', 'acquired']);
    results.oldLocalNegativeDoubleAcquired = true;
    await partition(false);

    for (const down of [0, 1]) {
        docker('stop', names[down]); await sleep(12000);
        const survivor = 1-down, name = `${namespace}.down${down}`;
        const initial = await acquire(survivor, name);
        assert.equal(initial.status, 'held', JSON.stringify({ down, initial }));
        await command({ advanceMs: 300000 });
        const solo = await acquire(survivor, name); assert.equal(solo.status, 'acquired', JSON.stringify(solo));
        assert.equal((await release(survivor, name, solo)).status, 'released');
        docker('start', names[down]); await sleep(20000); delay(); await partition(false);
    }
    assert(localProofs > 0, 'RDM must confirm lost DC1 using local SERIAL/QUORUM before arbitration');
    results.sfoDownRdmRuns = results.rdmDownSfoRuns = true;

    // DO clock advancement does not fake Scylla expiry: wait out actual 600s local TTL after crashes.
    const wait = Math.max(0, ...crashed.map(r => r.expiresAfter - Date.now()));
    console.log(JSON.stringify({ phase: 'waiting-real-cql-crash-ttl', waitMs: wait, results }));
    await sleep(wait);
    for (const crash of crashed) {
        const recovered = await acquire(crash.owner, crash.name);
        assert.equal(recovered.status, 'acquired', JSON.stringify(recovered));
        assert.equal((await release(crash.owner, crash.name, recovered)).status, 'released');
    }
    results.crashRealTtlRecovery = true;
    }
    console.log(JSON.stringify({ results, arbiterCalls, soloWrites, localProofs }));
} finally {
    try { if (names.every(name => docker('inspect', '--format', '{{.State.Running}}', name).trim() === 'true')) await partition(false); } catch {}
    await Promise.all(clients.map(c => c.shutdown()));
    if (!fixture.killed) { fixture.stdin.write('{"stop":true}\n'); fixture.stdin.end(); }
    for (const name of names) { try { docker('stop', name); } catch {} }
}
