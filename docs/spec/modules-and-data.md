# Modules and Data

## Module Map
- `src/constants/contractsRegistry.ts`: static map of known contract key hashes to project metadata.
- `src/logger/index.ts`: shared structured logger and log category contract, including `USER_ISSUE`.
- `src/handles/interfaces/*`: canonical types for handle metadata, personalization, API data, and mint settings.
- `src/repositories/interfaces.ts`: contracts for OAuth clients/grants and permissions.
- `src/marketplace/interfaces.ts`: marketplace listing and payout datum shapes.
- `src/types/*`: shared enums and utility types (network, address type, profile header settings, gallery items).
- `src/utils/index.ts`: shared utility helpers including user-issue tracking ID and event-key normalization helpers.

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
