# Shared-library canonical contract and enclave proposal

**DRAFT / NOT ACTIVATED / DO NOT MERGE OR INSTALL UNATTENDED.** Individual human policy review is required. Phase 5 remains open.

- [Proposed canonical contract](./CANONICAL_CONTRACT.md)
- [Candidate enclave](./.enclave)
- [Documentation index](../../index.md)

## Scope and source

Grounded in fresh master `81baab5885b9dfb107ad3df606b1cf74ae4c678b`; inspected checkout source/package/lock match that base. Four documentation/policy files only. No runtime, dependency, version/release, AGENTS.md/CLAUDE.md, root policy, infrastructure/Worker, configuration, credential, lease, provider or chain changes. Existing package/release owner explicitly acknowledged parent-only proposal ownership; this does not transfer source/release authority.

The candidate contains **41 exact root-relative paths**: 39 current implementation files plus two prospective root adoption destinations. Shared locking, transport and chain-provider conversion; policy/slot, wallet/address, transaction body/finalization and CBOR schema boundaries; explicit R2/JWT/legacy-settings guards; root/server barrels and read-only/live-testing safety controls. These files mix responsibilities and would require review for ordinary edits after adoption. Human reviewers must accept or narrow that cost. No wildcard, blanket source directory, tests, docs or workflow freeze is proposed.

Transitive dependencies, package/export metadata, infrastructure's signed arbiter, configuration/topology and new unprotected callers remain limitations. Existing numeric types are not uniformly BigInt. Library tests do not prove consumer authorization, exactly-once minting, address/chain truth in every caller or private-wallet signer compatibility. The proposal preserves existing coordination/offline semantics instead of inventing a stronger or easier failover mode.

## Real policy and nonactivation

The actual bot parser accepts exact lines and trailing-slash prefixes, not globs/exclusions/DRAFT directives. Entries remain root-relative despite this nested location. `load_manifest` discovers `v3/.enclave` then root `.enclave`; **location makes this proposal inactive, not the DRAFT comment**.

Bot merge enforcement fetches the authoritative target/base manifest, checks current and previous filenames, and protects master/main/mainnet/preprod by default, not preview. Auto-merge does not bypass the approval gate; failed manifest retrieval does not mean absence. This is bot-tool enforcement, not a universal GitHub/direct-CLI/admin control. A first root installation cannot self-protect from a previously absent manifest and needs separate exact human review.

## Verification actually performed

- Existing guarded offline library suite: `npm test -- --runInBand`, **490 tests in 51 suites passed**, zero snapshots. It uses real transforms/SDKs and system-boundary fakes/owned loopback servers; not live provider/chain/production lease calls or browser journeys. No new dependency installation, Scylla/Worker drill or historical lab rerun.
- Existing bot parser/merge policy: **36 tests passed**, `test_enclave.py`, `test_merge_manifest_http.py`, `test_merge_pr_auto_merge_gate.py`.
- Real manifest validation: all 39 implementation entries exist in the immutable base; 41 exact/no prefixes; lock/wait/wallet/tx/schema boundaries match; unrelated tests/docs/workflow/package manifest do not; nested policy does not activate. Removing the rate-limit entry breaks that critical match; adding `src/` violates the unrelated-test exclusion (negative controls).
- Local receipts: `tmp/phase5-common/{native.log,parser-validation.json,merge-gates.log}`. These are proposal-review receipts, not a newly measured coverage percentage, release, installed consumer proof or current two-DC/financial acceptance.

## Human decisions before adoption

Review the exact draft, invariants, 41-path/mixed-file costs, branch scope and limitations. Decide whether dependency/export or additional caller boundaries need separate protection. Approve a separate root-installation diff only after individual review. Keep this draft unmerged; green CI or permission to prepare policy is not adoption, package publication, automatic-solo activation or financial authority. Wallet-candidate exclusivity/preparation limits, #75's no-merge restriction, coverage/quality/recovery holds and provider/payment deadlines remain untouched.
