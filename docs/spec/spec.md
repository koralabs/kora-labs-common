# Technical Spec

## Architecture

### Module Groups
- `constants`: runtime constants, network flags, policy lists, contracts registry.
- `environment`: compute-environment and runtime metadata discovery.
- `logger`: structured logging utilities and category controls.
- `http`: lightweight request/response wrappers.
- `handles`: handle domain constants, interfaces, models, policy helpers, API wrapper, and UTxO model.
- `protectedWords`: protected/reserved word policy engine.
- `utils`: generic utilities plus `crypto` and `cbor` submodules.
- `repositories`, `marketplace`, `types`: shared contracts/types consumed by service repos.

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
