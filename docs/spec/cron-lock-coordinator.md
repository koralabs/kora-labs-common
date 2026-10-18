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

Validation: focused `npm test -- --runInBand src/cronLock src/chain/transport` passed 83 tests across 7 suites; `npm run build` passed. Renewal regression was run with the refreshing guard removed and failed (`peerUnavailable` instead of `unavailable`), then restored. Final full local `npm test -- --runInBand` passed 454 tests across 44 suites (zero snapshots, exit 0); detached run logs are under `tmp/final-validation/`. There are no standalone browser journeys in this package; Playwright helper behavior tests are included in the unit suite. Disposable two-box database acceptance below remains a separate integration gate, not something the in-memory behavior tests claim to prove.

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

Negative control: run `node scripts/test-cron-lock-coordinator.cjs 172.20.0.2 172.20.0.3 --local-coordinator-negative-control`. This substitutes only the actually served old `new Client({contactPoints,localDataCenter,socketOptions})` executor factory, retaining the actual acquire/release implementation and every assertion. The test must fail. This proves the test observes the routing defect rather than merely exercising a fake lock. Run again without the flag to validate the fixed factory.

Also stop each LAB peer in turn: an all-online acquisition must never return acquired without cross-DC quorum; an explicitly declared sole-online caller must still use its own DC. Never trigger application mint/refund jobs to test this.

## Live incident evidence: 2026-10-18

Read-only inspection of both mainnet HAL `0.0.135682591` and minting `0.0.11953692` images found application common **6.19.1**, not the locally repaired 6.20.3. The separate bridge's common 6.15.3 is not the application package. The HAL application bundle `function/lambda_handler-BcthHYIj.js` has SHA256 `7b7c177ff3e3bb68b55b8b3cec8bf0153c483cb888320788c58da2e1dfc4319a` and contains driver 4.10.0 metadata and the old `getClient` constructing only local contact points, local DC and 8000/12000 ms socket timeouts. Minting's `function/deploy-wi7Kdwxq.js` bundle has SHA256 `8e10fd9568a8d5c9ad211fec3dd6f8b17ddc2b9d54d6fa0c7be9b07df065fed0` and driver 4.9.0 metadata; its producer likewise uses the local client without a SERIAL profile. The local regression uses installed driver 4.10.0, matching HAL; do not misreport minting's older bundled driver as 4.10.0. Actual environment values on both boxes match topology: SFO `100.124.13.105:9042` / `kora-dc1`; RDM `100.94.227.122:9042` / `kora-dc2`.

Both nodes report the same schema version `31c1b326-7674-11f1-bb89-514c8c66b78a`; `kora_locks` has NTS RF1 in each DC, and `cron_lock` is a vnode table. Runtime REST configuration on both: contention 1000 ms, write 2000 ms, read 5000 ms, range/request 10000 ms, cross-node timeout false. Independent infrastructure evidence found direct approximately 55 ms WAN RTT, no current packet loss, synchronized sub-millisecond clocks and no resource pressure. Increasing timeouts or changing consistency is not the correction.

The observed causal chain is:

```text
served 6.19.1 topology-local coordinators on opposing DCs
  -> simultaneous same-partition Paxos leaders across the WAN
  -> partial acceptances and ambiguous SERIAL write outcomes
  -> SERIAL owner reconciliation can itself contend and fail
  -> token-conditional retraction can remain unknown
  -> lease-expiry recovery, with protected work unavailable in the meantime
```

Lifetime uncertainty counters summed across shards were SFO 3633 and RDM 9990. A subsequent passive snapshot at 02:18 UTC showed SFO +2 uncertainty, +1 write timeout, +1 read timeout; RDM +0 uncertainty and +1 write timeout relative to the earlier snapshot. These are cluster-wide counters, not per-application attribution or an incident-specific loss measurement. Raw read-only evidence is retained locally under `tmp/live-lock/`; infrastructure has independent OS/WAN evidence. No SERIAL read or LWT was issued against production lock rows: schema/system reads, runtime configuration, metrics and image inspection only.

The isolated two-DC Scylla 6.2 regression at 25 ms egress delay on each LAB node reproduced the exact production failure with the old factory at round 6: one acquired, the other unavailable with SERIAL 1/2, owner SERIAL read 1/2 and failed retraction. Without the negative-control flag the repaired factory passed all 100 rounds: 100 acquired, 100 held, 100 non-owner releases preserving the winner, 100 winning releases, zero database errors including recovered exceptions, and only DC1 coordination. With each LAB peer stopped in turn, all-online acquisition remained fail-closed (DC1 survivor: peerUnavailable; DC2 survivor: unavailable), while explicitly declared solo mode acquired and released through the surviving local DC. Both edge tests exited 0. The application source fix already exists in 6.20.3; this incident follow-through adds reproducible proof, not another timeout/fallback patch or package/API change.

Independent HAL owner image inspection found both preview instances on common 6.20.2 with DC1 routing and both preprod instances still on 6.19.1 with local routing. Natural preview windows at 02:12–02:15 alternated completion between the boxes while the other skipped. This establishes admission on both nodes, not refund success. At that initial inspection mainnet remained uncorrected; the later authorized mainnet installed acceptance is recorded below.

Mint driver compatibility follow-up: reran the same existing isolated lab and unchanged harness with common 6.20.3 and the **real Mint-installed cassandra-driver 4.9.0** from `../minting.handle.me/node_modules/cassandra-driver` (test-process module binding only; no source, dependency, branch or Mint checkout edits). Both LAB nodes again had 25 ms egress delay. The old 6.19.1 **client-factory** negative control (not a full old-SDK replacement) actually failed at zero-based round 1 with the same SERIAL 1/2 → owner-read 1/2 → failed-retraction outcome. Fixed 6.20.3 passed all 100 rounds: 100 acquired, 100 held, 100 non-owner-preserving releases, 100 winning releases, zero database errors, sole coordinator `172.20.0.2:9042`, exit 0. Both peer-down cases also exited 0: DC1 survivor normal peerUnavailable; DC2 survivor normal unavailable; each explicitly declared solo acquisition and release succeeded locally. Raw logs: `tmp/live-lock/lab/driver-4.9/{negative,fixed,peer-down-dc1,peer-down-dc2}.log`. LAB containers were returned to stopped state without deleting their data. This confirms the actual Mint driver semantics, not just HAL's 4.10.0 driver; it authorizes no mainnet activation or value-moving operation.

### Preprod installed acceptance, 02:42 UTC

Minting Actions `39090500912` attempt 2 completed on both boxes under trigger `1138bd1d-0ed4-41e0-8000-38b8801e7ce3`, source `5d9ec6696c7df034b3e03c40cd3fc2cad36fa831`, deployment artifact SHA256 `81a02ccaa8a218ba04058f112f77605dbd55fcfee7dfedad688de10b4ffd2dfc`. Independent read-only Fn API inspection found both functions referencing `kora-preprod-minting:0.0.168968165`, updated SFO `02:40:53.361Z` and RDM `02:40:53.922Z`, with the correct local contact/DC configuration. The supplied successful deploy records complete at `02:41:08Z`; the earlier partial rollout was not counted as both-box acceptance.

Both actual image-save streams contain identical application bundle `function/deploy-CfUv3NNQ.js`, SHA256 `cd67007ace61bc570490d5a16a3ca77b1e5af854c11a9745fdeb406b0d5c644e`. It contains bundled driver **4.9.0**, the `cron-lock-serial` profile with `DCAwareRoundRobinPolicy('kora-dc1')`, and routing of both SERIAL reads and conditional writes to that profile. The source contains the unique 6.20.3 renewal-unconfirmed and offline-release-unknown corrections. In this new fully bundled layout the application common package manifest is absent (`function/package.json` has no common dependency); therefore version provenance is the real vendored 6.20.3 build input plus the actual compiled corrections, not an invented runtime manifest. The separate bridge's 6.15.3 manifest is not the application SDK. Different per-box Docker image IDs do not imply different application bundles; their independently extracted bundle hashes match.

HAL owner separately confirmed both preprod instances on actual bundled common 6.20.3, driver 4.10.0 and shared DC1 routing under green run `39090696611`, trigger `b585f5fd-dee4-4ae7-bd3a-71d86e03d502`; bundle `lambda_handler-Gt7Jrnq5.js` SHA256 `ce692906147ec2fcc5c2a484c75ed2426fb22af39e2392c88d362de8576d5ecf`. Three natural windows at 02:38–02:40 alternated the completing node with one skip each and no matching post-flip lock/refund/error logs. This supports lock recovery, not refund completion. Minting's independent owner retains passive natural-worker acceptance after the both-box flip; image proof alone is not protected-job progression or backlog recovery. No handler was invoked manually and no production lock row was read/written by this verification.

### Authorized minting mainnet installed acceptance, 16:15 UTC

After explicit operator approval, minting Actions `39143894170` completed on both boxes under trigger `fa124d8a-2c54-444e-8084-6c79723e4a82`, source `2eeba7db31cda3be1401ffbe740327e141d3a7f0`, version `f4d05b6946c6887487ae169f75c041`, artifact SHA256 `346bcc8a1966726c85adeaf8bf87c572928916cfd42b81d987d669968d64cbf7`. The rollout owner reported both applies at `16:14:14Z`. Independent read-only Fn API inspection at `16:15:30–31Z` confirmed both functions referencing `kora-mainnet-minting:0.0.189549416`, updated SFO `16:13:55.747Z` and RDM `16:13:55.568Z`, with correct MAINNET/node/contact/DC values.

Both independently saved images contain identical `function/deploy-f-FE1iy7.js`, SHA256 `906422934a7d79a886fe8337a61c8d48fd549426275145215fb720c6d2afe79b`. Actual compiled driver is **4.9.0** on both; both contain the shared `cron-lock-serial` profile pinned to `kora-dc1`, and route SERIAL conditional writes and SERIAL owner reads through it. Both unique common 6.20.3 renewal-unconfirmed and offline-release-unknown corrections are compiled into this bundle. As in preprod, the application common manifest is absent in this fully bundled layout; SDK provenance is the real vendored 6.20.3 source/build input plus the actual compiled corrections, not the bridge's unrelated manifest. Image inspection exited 0 on both boxes. Raw verification: `tmp/live-lock/mint-mainnet/`.

This confirms installed correction on both mainnet boxes, not protected-work completion or backlog recovery. The rollout owner separately owns read-only application checks and natural 16:15/16:20/16:25 worker-window evidence. This independent verification made no job/handler invocation, lock-row/LWT query, value-moving call or Discord call.

## Landing and serving acceptance

This is a package change, not a deployment. Update both minting and HAL consumers/lockfiles on their own approved branches using the actual 6.20.3 tarball already supplied, with its real integrity and tracked vendor file accepted by the canonical build validator. Publication is not authorized for this incident; a missing registry version is not permission to fabricate lockfile metadata or bypass the validator. Land the canonical vendor-validation support first, pin its tested immutable revision in consumer workflows, then use the ordinary GitHub Actions preprod path. Do not infer serving from the package version alone. Inspect both deployed artifacts' lock client and collect same-window database metrics and protected cron outcomes on BOTH boxes. Require bounded acquisition, safe losers, protected work, release and backlog-age evidence. Observe repeated timer collisions, not just an idle minute. Old ambiguity and lease-expiry paths remain safety/recovery mechanisms, not proof of repair.
