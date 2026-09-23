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
- `encodeJsonToDatum` converts JSON into datum-compatible CBOR with options for numeric keys, text defaults, and array encoding mode.
- `decodeCborToJson` supports schema-guided map decoding and constructor/tag reconstruction.

## Operational Notes
- `HandlesApi` must be initialized before use; requests include `KORA_USER_AGENT` and optional API key headers.
- Logger local colorization is enabled only when `IS_LOCAL=true`.
- `Logger.log` supports a structured `context` payload for machine-readable operational events.
- `createUserIssueTrackingId` + `isUserIssueTrackingId` provide shared `UI-<base36Timestamp>-<base36Random6>` tracking ID generation/validation.
- `normalizeUserIssueEventSegment` + `buildUserIssueEventKey` provide deterministic `user_issue.<repo>.<flow>.<pathOrFunction>.<step>` event naming.
- Slot/date helpers depend on network epoch constants and should stay synchronized with Cardano network assumptions.
