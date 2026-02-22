# Integration Surfaces

## Import Surface
- Main package entrypoint re-exports domain modules through `src/index.ts`.
- Consumers import only what they need (`Logger`, `ProtectedWords`, `encodeJsonToDatum`, handle models/interfaces, crypto helpers).

## Runtime Inputs
- `NETWORK`: controls network defaults and slot/date conversion behavior.
- `NODE_ENV`: combined with `NETWORK` to determine production mode checks.
- `APPLICATION_NAME`, `AWS_*`, `ECS_CLUSTER`: used by environment/logger metadata.
- `IS_LOCAL`: toggles local logger behavior.
- `KORA_USER_AGENT`, `HANDLES_API_KEY`: used by `HandlesApi` requests.

## External Integrations
- `https://api.handle.me` via `HandlesApi` host initialization.
- AWS metadata endpoints for environment/IP detection when running on EC2/ECS.
- Browser or Node crypto primitives for PKCE and hashing flows.

## Consumer Responsibilities
- Call `HandlesApi.init(...)` before making API requests.
- Set required env vars for network and API identity headers.
- Implement `IOAuthRepo` in service repos; this package only defines the contracts.
