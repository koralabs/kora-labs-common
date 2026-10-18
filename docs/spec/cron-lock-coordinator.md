# Cron-lock coordinator

[Modules](./modules-and-data.md#cron-lock-coordinator-routing) · [PRD](../product/prd.md#safety-and-policy-utilities) · [Documentation](../index.md)

## Failure and correction

Both application boxes submitted the same cron-lock partition to their own DC's coordinator. At WAN latency, their concurrent Paxos leaders could each obtain only a partial acceptance. Scylla 6.2.3 intentionally reports that ambiguity as SERIAL write timeout even when all replicas have answered. The counter `scylla_storage_proxy_coordinator_cas_write_timeout_due_to_uncertainty` measures that path. Its source is `service/storage_proxy.cc`, `accept_proposal`, at tag `scylla-6.2.3`; the same coordinator's `get_cas_lock` serializes same-partition proposals.

The enabling condition was default local-DC driver routing combined with cross-DC, simultaneous cron callers. Shared SERIAL coordinator routing corrects the producer. It is not a retry, quorum change, local ownership assumption, or longer contention deadline. All write, read, cleanup, release, token and lease rules remain unchanged.

`cqlClient.ts` declares a `cron-lock-serial` execution profile with DC-aware routing to `kora-dc1`. Queries having SERIAL `serialConsistency` or SERIAL read `consistency` use it. All other queries retain the original local profile. Exactly one replica/node per DC is required by this topology. Do not extend the cluster without revisiting single-coordinator routing.

If that coordinator is unreachable, acquisition remains fail closed; there is no added alternate coordinator or local-ownership fallback. An unreachable primary may now produce a driver connection error instead of the definite UNAVAILABLE previously received from the remaining local coordinator. Existing caller fallback eligibility can therefore become narrower. Declared solo mode remains local. This availability tradeoff requires review; it never authorizes weakening ownership.

## Response lifecycle follow-up (6.20.3)

Driver `NoHostAvailableError` can wrap an ambiguous timeout; any nested timeout now triggers serial owner reconciliation, never solo fallback. An UNAVAILABLE during renewal is not proof that the preceding acquisition was unaccepted. Failed renewal cannot establish a fresh lease by reading the old token: the invocation retracts only its own token and returns unavailable instead of running under an unconfirmed lease. An offline caller still does no database work on release, but reports unknown rather than falsely confirming release. These correct classification/ownership bugs; TTL remains recovery only. Shared DC1 coordinator routing and token-conditional deletes are preserved.

HTTP body-read failures retain the observed response status on the original error, so consumers do not mistake an observed provider failure for an unobserved transport failure. Admission and body observation still use the shared lifecycle introduced in 6.20.2.

Consumer integration: update `@koralabs/kora-labs-common` to 6.20.3 in minting.handle.me, hal-minting-engine and any JSON/raw-response transport consumers (including handle.me), updating their lockfiles together. No API signature changes. Publishing and consumer integration are intentionally deferred to the parent; this package task performs neither deployment nor publication.

Focused validation: `npm test -- --runInBand src/cronLock src/chain/transport` and `npm run build`. Renewal regression was run with the refreshing guard removed and failed (`peerUnavailable` instead of `unavailable`), then restored. No full suite is run here; parent integration owns it. Disposable two-box database acceptance below remains a separate integration gate, not something the in-memory behavior tests claim to prove.

## Local integration test only

Never run this in GitHub Actions or against production. Use two disposable `scylladb/scylla:6.2` containers on an isolated Docker network with subnet `172.20.0.0/16` and IPs `172.20.0.2` / `172.20.0.3`, one CPU and 1 GiB each. Mount `cassandra-rackdc.properties` with `dc=kora-dc1` / `dc=kora-dc2`, respectively. Use `--endpoint-snitch GossipingPropertyFileSnitch`, seed the second from the first, and wait until BOTH are UN before adding delay. Delay during bootstrap makes repair unnecessarily slow.

For each container, apply `tc qdisc add dev eth0 root netem delay 25ms` in its network namespace only (for example, host `nsenter -t <container-pid> -n tc ...`). This introduces approximately 50 ms inter-DC round trips without modifying the workstation's network interface. Do not apply it to production.

Run:

```bash
npm run build
npm test -- --runInBand src/cronLock
node scripts/test-cron-lock-coordinator.cjs 172.20.0.2 172.20.0.3
```

The script creates only a disposable lab keyspace/rows. Scylla 6.2 defaults new keyspaces to tablets, which do not support LWT in this version; the lab explicitly creates vnode keyspaces (`tablets={'enabled':false}`), matching the production lock table.

Acceptance: 100 concurrent two-box rounds, exactly one acquired and one held per round, zero database exceptions (including those hidden by owner reconciliation), SERIAL reads from both callers use DC1, non-owner release preserves the winner, winner release removes the row. Offline caller stand-down and invalid offline input are also asserted.

Negative control: substitute only the old `new Client({contactPoints,localDataCenter})` executor factory, retaining the actual acquire/release implementation and test. The test must fail. This proves the test observes the routing defect rather than merely exercising a fake lock. Restore the fixed factory and rerun.

Also stop each LAB peer in turn: an all-online acquisition must never return acquired without cross-DC quorum; an explicitly declared sole-online caller must still use its own DC. Never trigger application mint/refund jobs to test this.

## Landing and serving acceptance

This is a package change, not a deployment. Publish the reviewed version and update both minting and HAL consumers/lockfiles on their own approved branches. Do not infer serving from the package version alone. Inspect both deployed artifacts' lock client and collect same-window database metrics and protected cron outcomes on BOTH boxes. Require bounded acquisition, safe losers, protected work, release and backlog-age evidence. Observe repeated timer collisions, not just an idle minute. Old ambiguity and lease-expiry paths remain safety/recovery mechanisms, not proof of repair.
