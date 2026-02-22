# Feature Matrix

| Area | Capability | Key Files |
| --- | --- | --- |
| Package entrypoint | Re-export shared modules for downstream apps | `src/index.ts` |
| Runtime constants | Environment/production/network flags and common constants | `src/constants/index.ts` |
| Environment detection | Compute environment, application name, metadata IP lookups | `src/environment/index.ts` |
| Logging | Structured logs, local category coloring, async init fallback | `src/logger/index.ts` |
| HTTP helpers | Request cookie parsing and response cookie management | `src/http/index.ts` |
| Handle domain models | Handle/subhandle constants, interfaces, search/pagination models | `src/handles/*` |
| Handle API helper | API client wrapper for `api.handle.me` + required headers | `src/handles/api.ts` |
| Policy resolution | Active policy checks across preview/preprod/mainnet | `src/handles/policies.ts` |
| Protected words | Availability checks with normalization/algorithm rules | `src/protectedWords/index.ts` |
| Cardano crypto utilities | Address decoding, stake extraction, CIP-67 parsing, blake2b | `src/utils/crypto/index.ts` |
| CBOR utilities | JSON<->datum conversion and schema-aware decoding | `src/utils/cbor/index.ts` |
| Shared data contracts | OAuth repository interfaces, marketplace listing interfaces, core types | `src/repositories/interfaces.ts`, `src/marketplace/interfaces.ts`, `src/types/*` |
