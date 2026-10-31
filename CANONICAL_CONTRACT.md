# Canonical contract — kora-labs-common

The paths that carry these invariants are listed in [`.enclave`](./.enclave); a change to them needs operator approval before merging.

## Purpose and authority

I provide shared Handle types/codecs, chain transport, transaction/wallet primitives, cron coordination and explicit storage/auth configuration. Consumers retain responsibility for their business authorization and chain verification. A library release, successful unit suite or acquired lock is not proof that a customer goal, mint, refund or burn succeeded. Maintenance permission never authorizes a production lease experiment, money movement, signing, settings/validator change or live wallet journey.

## Invariants

1. **One authorized worker, not optimistic availability.** Preserve unique ownership tokens, conditional release/retraction, SERIAL reconciliation and the shared DC1 coordinator. Unknown/ambiguous acquisition or renewal is not permission to work. Opted-in automatic/declared solo requires its existing signed DO grant, drain, remaining lifetime and same CQL-row ownership; a grant alone is insufficient. Preserve durable per-owner causal history and existing explicit operator offline semantics (including omitted/false arbiter equivalence). Do not substitute a local independent mutex, reset metadata, clear production rows or grant HAL new automatic-solo authority. Existing topology assumptions and separate two-DC integration requirements remain authoritative in [the coordination specification](../../spec/cron-lock-coordinator.md).
2. **Provider waits survive the whole lifecycle.** Record the maximum applicable provider wait across dispatch, headers, body, parsing and queued callers; never shorten it through retry, redirect, timeout or a new call. Preserve status/absence provenance, same-key admission ordering and hard per-attempt dispatch/body deadlines. A 429 with no stated wait is not permission for blind retries; timeout is not proof a non-GET was unaccepted. Do not reintroduce node-fetch clone-body deadlock or infer HTTP 404 from payload fields/raw exception attributes.
3. **Chain-data and address fidelity.** Preserve network, policy, recipient/address, asset identity/quantity, datum and input references through provider conversion, wallet parsing and codecs. Do not invent absence, success or a different recipient from malformed responses. Shared policy selection and CBOR conversion must preserve their existing contracts; a formatted address or indexed response is not proof of current chain ownership. Existing numeric representations are not uniformly BigInt, so this contract does not certify arbitrary integer precision throughout legacy interfaces.
4. **Signed-body and ledger fidelity.** Witness merging must preserve transaction body/id and script witness bytes; finalization must preserve caller-fixed inputs, correct redeemer ordering and fee/change/script-data relationships. Offline evaluation is not equivalent to node execution or authorization to submit. No silent compiler/validator/settings substitution or test-generated signature may stand in for chain acceptance. Transaction-building and submit-capable exports remain separate from permission to invoke them.
5. **Explicit security/authority surfaces.** Preserve explicit R2/public-URL configuration and rejection of retired encrypted-setting hydration/ambient AWS discovery. JWT signing is not transaction-signing authority. Keep server-only modules out of the root browser barrel. Read-only wallet guards must continue rejecting fund-moving transaction signing/submission (`signTx`, `signTxs`, `submitTx`), not all signing. Other methods, including `signData`/OAuth flows, pass through to the inner wallet; `liveWallet.ts` implements real CIP-8 message signing. This existing passthrough is not permission expansion or a guarantee that these helpers are unsigned wallets. Live testing helpers are opt-in capabilities, not permission for unattended production use. Never log credentials or use real wallets/provider endpoints as fixtures.

## Evidence and enforcement limits

Existing offline suites exercise real codecs, byte identity, wallet/address decoding, provider lifecycle, CQL/arbiter behavior through system-boundary fakes and owned loopback servers. They do not prove a current two-box partition matrix, live leases, consumer deployment, payment recovery or chain effects. No old lab result is re-executed or upgraded by this contract.

Exact-path policy is not a complete call graph or universal access control. Other callers, unprotected modules, dependency/package/export metadata, infrastructure/Worker authority, live configuration and direct administrative merges remain outside this contract's guarantee. Mixed-responsibility protected files impose human review costs; review may narrow or expand them. The enclave is not complete enforcement of these invariants.

## Refactors needed to enforce this

- No automated test pins invariant 5's browser-barrel rule (server-only modules stay out of the root export); add an export-surface test.
- Invariant 3 has no uniform BigInt for legacy numeric interfaces; migrate them before claiming integer precision.
- Invariant 1's two-DC partition behaviour is only covered by fakes; a real two-DC integration drill is not automated.
- Exact-path enclave cannot cover new callers or package/export metadata; a package `exports` check would close that.
