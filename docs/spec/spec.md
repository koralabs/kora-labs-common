# Technical Spec

## Architecture

### Module Groups
- `constants`: runtime constants, network flags, policy lists, contracts registry.
- `environment`: compute-environment and runtime metadata discovery.
- `logger`: structured logging utilities and category controls, including `LogCategory.USER_ISSUE` and structured `context` payload support.
- `http`: lightweight request/response wrappers.
- `handles`: handle domain constants, interfaces, models, policy helpers, API wrapper, and UTxO model.
- `protectedWords`: protected/reserved word policy engine.
- `utils`: generic utilities plus `crypto` and `cbor` submodules, including `createUserIssueTrackingId`, `isUserIssueTrackingId`, `normalizeUserIssueEventSegment`, and `buildUserIssueEventKey`.
- `repositories`, `marketplace`, `types`: shared contracts/types consumed by service repos.
- Subpath-only (server) modules, not on the root barrel: `aws`, `chain` (provider transport with process-wide rate-limit compliance, Koios/Blockfrost read providers), `txBuild` (Helios-free Plutus tx finalizer, fees, script data hash, Blockfrost evaluate/submit on `@cardano-sdk/core`), `cronLock` (cross-DC CQL SERIAL cron mutex on `cassandra-driver`), `mpt`, `testing`; plus the isomorphic `tx` byte-level helpers. See [Modules and Data](./modules-and-data.md).

### Entry Surface
- `src/index.ts` exports the public API; downstream services should avoid deep-importing internals unless required.

## Data and Validation Rules
- Handle search/pagination model constructors validate inputs and throw `ModelException` for invalid values.
- Handle pattern checks enforce allowed character formats and length constraints.
- Protected words pipeline normalizes handles and applies multiple matching strategies before allowing availability.
- Address helpers return `null` for invalid payloads and perform type discrimination from address header bytes.

## Error Model
- `OauthAccessError`: OAuth-specific code + message.
- `ModelException`: invalid query/model input.
- `HttpException`: explicit status + message for HTTP-layer use.

## Runtime Dependencies
- Crypto/address stack: `bech32`, `blakejs`, `bs58`, `crc`.
- CBOR stack: `cbor` + schema helpers.
- Protected words inflection: `pluralize-esm`.
- Optional peers (only for the subpath modules that need them): `@cardano-sdk/core` (`txBuild`, `testing`, `tx` tests), `cassandra-driver` (`cronLock`), `@aiken-lang/merkle-patricia-forestry` (`mpt`).
- Test tooling: `jest` + `ts-jest`.

## Testing and Coverage
- Unit tests run with `npm test`.
- Coverage guardrail runs with `./test_coverage.sh` and writes `test_coverage.report`.
- Guardrail threshold: minimum 90% line and branch coverage.
- Guardrail measured scope currently includes:
  - `src/constants/contractsRegistry.ts`
  - `src/constants/mintedOgList.ts`
  - `src/errors/index.ts`
  - `src/handles/interfaces/index.ts`
  - `src/types/index.ts`
  - `src/types/profile-header.ts`
  - `src/utils/cbor/schema/{designer.ts,handleData.ts,marketplaceDatum.ts,portal.ts,socials.ts,subHandleSettings.ts}`
- Broader runtime modules remain covered by `npm test` but are excluded from guardrail branch thresholds until follow-up branch-gap work is completed.
