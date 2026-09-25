# Modules and Data

## Module Map
- `src/constants/contractsRegistry.ts`: static map of known contract key hashes to project metadata.
- `src/logger/index.ts`: shared structured logger and log category contract, including `USER_ISSUE`.
- `src/handles/interfaces/*`: canonical types for handle metadata, personalization, API data, and mint settings.
- `src/repositories/interfaces.ts`: contracts for OAuth clients/grants and permissions.
- `src/marketplace/interfaces.ts`: marketplace listing and payout datum shapes.
- `src/types/*`: shared enums and utility types (network, address type, profile header settings, gallery items).
- `src/utils/index.ts`: shared utility helpers including user-issue tracking ID and event-key normalization helpers.
- `src/tx/*` (subpath `@koralabs/kora-labs-common/tx`, isomorphic, no network): byte-level signed-tx assembly — `mergeWitnessSet` (merge a CIP-30 `signTx(tx, true)` witness set without re-encoding the body or Plutus witnesses; drops fee-estimation placeholder vkeys), `txHashFromCbor`, `skipCborItem` / `locateWitnessSet` / `locateTxBody`, and `findCanonicalCborViolations` / `assertCanonicalCbor` (CIP-21 key order of the body + witness maps only).
- `src/wallet/*` (subpath `@koralabs/kora-labs-common/wallet`, isomorphic, no network; optional peer `@cardano-sdk/core`): reading what a CIP-30 wallet returns, with `@cardano-sdk/core` `Serialization` (never a hand-rolled or generic CBOR decoder) — `WalletApi` (CIP-30 + CIP-95/CIP-103 extensions), `parseUtxo` (`getUtxos()` entry → `{ cbor (verbatim), id, lovelace, assets[{ policyId, hex, count }] }`; legacy array-form and Babbage map-form outputs incl. inline datum / reference script; `null` for anything that is not a UTxO), `lovelaceFromBalance` (`getBalance()`), `addressHexToBech32` (Shelley → bech32 with the network prefix, reward → `stake`/`stake_test`, Byron → base58). Tests run against real CIP-30 UTxO CBOR (`src/wallet/fixtures`) checked against Blockfrost. Used by the handle.me and hal.handle.me wallet contexts.
- `src/txBuild/*` (subpath `@koralabs/kora-labs-common/txBuild`, server-side, NOT on the root barrel; optional peer `@cardano-sdk/core`): Plutus transaction building without Helios —
  - `finalizeScriptTx(plan, params, evaluate)`: deterministic finalizer for txs whose inputs the caller fixes (engines/crons). Derives redeemer pointers from the ledger's canonical orderings (inputs, policies, withdrawals, reference inputs), tops outputs up to min-UTxO, asks the NODE for execution units (`evaluate`, re-run after the fee settles because fee and change are part of the ScriptContext), converges the fee to the exact ledger minimum for the signed size, puts the remainder in one change output, and computes `script_data_hash` over the redeemer bytes it ships.
  - `computeScriptDataHash`, `minFee` / `scriptExecutionFee` / `referenceScriptFee` (Conway's tiered 25,600-byte ×1.2 reference-script price; BigInt rationals, no floats), `minAdaForOutputSize`, `ratio`.
  - `addVkeyWitnesses`: signs by splicing vkey witnesses in with `mergeWitnessSet` (body, tx id and redeemer bytes untouched).
  - Certificates: `ScriptTxPlan.certificates` (stake (de)registration, legacy and Conway forms) with their deposits/refunds balanced into the change (`stakeKeyDeposit` from `key_deposit`); `selectWalletInputs` picks wallet UTxOs (ADA-only first, largest first) for txs whose fee comes from a wallet.
  - `scalus` helpers (optional peer `scalus`): `applyParamsToScript` (replaces Helios `UplcProgram.apply`; reproduces the deployed HAL mint-proxy hash), `plutusScript` / `plutusScriptHash`, `toSingleCbor` / `toDoubleCbor`, and `localEvaluator` (offline script evaluation for tests/tooling — close to, not identical with, the node's costs; production evaluates with the node).
  - `BlockfrostTxClient`: protocol parameters (cost models from `cost_models_raw`, the LEDGER order), tip/slot, UTxOs (with inline datums and resolved reference scripts), `getUtxo` (refuses spent outputs), `evaluateTx` (Blockfrost `/utils/txs/evaluate/utxos`: the node's evaluator, with not-yet-on-chain inputs supplied as additional UTxOs), `submitTx`. All calls go through the rate-limited transport.
  - Blockfrost's evaluator only accepts additional-UTxO values in the nested Ogmios shape `{ ada: { lovelace }, <policy>: { <asset>: qty } }`; the documented flat `assets: { "policy.asset": qty }` (even `assets: {}`) is rejected with "failed to decode payload from base64 or base16" (verified against preview, 2026-09-24).
- `src/cronLock/*` (subpath `@koralabs/kora-labs-common/cronLock`, Node-only; optional peer `cassandra-driver`): the cross-datacenter cron mutex for the self-hosted multi-DC Scylla topology (moved from minting.handle.me `helpers/cronLock/cqlCronLock.ts`). A CQL SERIAL `INSERT … IF NOT EXISTS USING TTL <lease>` on `kora_locks.cron_lock` (`<network>:<name>`), unique per-invocation owner tokens, operator offline set (`none` → SERIAL; this box offline → stand down; sole online box → LOCAL_SERIAL), fail-closed on unknown outcomes. `acquire(name, offline, { leaseMs })` takes a per-lock lease (default `STALE_EXECUTING_CRON_LOCK_MS` or 30 min). A SERIAL write timeout or a coordinator that never replied within the driver's readTimeout (`OperationTimedOutError`) (outcome unknown — seen several times a day between SFO and RDM, often after the write committed) is resolved by a serial read of the owner: own token → acquired, other → held, none → unavailable; when the read fails too, the invocation (which will not run) retracts its possibly-applied write with `DELETE … IF owner = <its token>` so it cannot idle every box for the lease. `release(name, token, offline)` (`releaseWithExecutor`) resolves a failed `DELETE … IF owner = <token>` the same way: a serial owner read, and if the row is still its own, one more token-conditional delete (never another box's row); an unresolvable release logs WARN `cqlCronLock.release.unknown` and the lease is the remaining recovery. Box fns receive `KORA_NODE_CODE`, `KORA_MINT_NODES`, `KORA_SCYLLA_DC`, `KORA_CQL_CONTACT_POINTS` from `fn_deploy.sh`.
- `src/chain/transport/*`: `fetchProviderJson` (rate-limited, provider-aware JSON transport) and `rateLimit` — every stated rate-limit wait (`Retry-After` seconds/date, `X-RateLimit-Reset-After`, `RateLimit-Reset`, `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset`, body `retry_after` / Google `RetryInfo.retryDelay`) is recorded per key for the whole process and sat out before any further call; a wait longer than `maxRateLimitWaitMs` (default 30 s) throws `RateLimitedError` carrying `retryAfterMs`; a 429 that states no wait is never blind-retried. Other transient failures (5xx, sockets) keep the bounded backoff.
- `src/testing/*` (subpath `@koralabs/kora-labs-common/testing`, Node-only, NOT on the root barrel): live CIP-30 journey-suite harness — `createLiveWallet` (mnemonic-derived CIP-30 emulator with real Blockfrost UTxOs/submission, per-suite `accountIndex`), `installLiveCip30Wallet` (bridges it into Playwright pages on every origin), `makeReadOnlyWallet` (mainnet smoke guard that blocks signTx/signTxs/submitTx), and Blockfrost on-chain effect assertions (`waitForTxConfirmation`, `waitForOutputConsumed`, `assertCip68Label`, `assertAssetBurned`, `assertAdaTransfer`, `fetchCip68ExtraFromTx`). Requires the optional peers `@cardano-sdk/core`, `@cardano-sdk/crypto`, `bip39`, and `@emurgo/cardano-message-signing-nodejs` (signData only).

## Critical Flows

### Handle Metadata Construction
- `buildMetadata` derives rarity/length/character attributes and subhandle metadata when `@` is present.
- `buildCharacters` and `buildNumericModifiers` normalize trait strings for persistence/indexing.

### Policy Selection
- `HANDLE_POLICIES.getActivePolicy(network, isDeMi, atSlot)` resolves policy by slot-window checks.
- `HANDLE_POLICIES.contains(network, policyId)` provides membership checks used by validators.

### Protected Word Evaluation
- `ProtectedWords.checkAvailability` executes a staged pipeline:
  1. numeric/non-alpha fast-path allowance,
  2. direct token match,
  3. replacement/trim match,
  4. stripped-character match,
  5. phrase-level contextual matching (hatespeech/suggestive/vulnerable modifiers).

### Signed Transaction Assembly
- Wallet contexts must never decode + re-encode a backend-built tx before signing: re-encoding can change bytes (definite vs indefinite arrays, integer widths), invalidating `script_data_hash` or the body the wallet signed.
- The flow is `signTx(txCbor, true)` → `mergeWitnessSet(txCbor, witnessSet)` → `submitTx`; `txHashFromCbor(signed) === txHashFromCbor(built)` proves byte-identity.

### Live CIP-30 Emulator Behaviour
- Mirrors a real wallet: full paginated `getUtxos`, `getCollateral` → `null`, `signTx` returns only its own vkey witnesses (stake key only when required), and refuses non-canonical tx structure as hardware wallets / Eternl do.

### CBOR Conversion
- `encodeJsonToDatum` converts JSON into datum-compatible CBOR with options for numeric keys, text defaults, and array encoding mode. It never modifies its input (it used to replace the caller's children with encoder wrappers in place, so encoding the same object twice produced garbage).
- `decodeCborToJson` supports schema-guided map decoding and constructor/tag reconstruction.

## Operational Notes
- `HandlesApi` must be initialized before use; requests include `KORA_USER_AGENT` and optional API key headers.
- Logger local colorization is enabled only when `IS_LOCAL=true`.
- `Logger.log` supports a structured `context` payload for machine-readable operational events.
- `createUserIssueTrackingId` + `isUserIssueTrackingId` provide shared `UI-<base36Timestamp>-<base36Random6>` tracking ID generation/validation.
- `normalizeUserIssueEventSegment` + `buildUserIssueEventKey` provide deterministic `user_issue.<repo>.<flow>.<pathOrFunction>.<step>` event naming.
- Slot/date helpers depend on network epoch constants and should stay synchronized with Cardano network assumptions.
