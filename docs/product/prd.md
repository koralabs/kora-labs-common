# kora-labs-common PRD

## Summary
`@koralabs/kora-labs-common` is the shared TypeScript package used by Kora Labs services for Handle domain models, Cardano utilities, runtime helpers, and common interfaces.

## Problem
Multiple services in the Handles ecosystem need the same core behavior (address parsing, handle metadata shaping, protected-word checks, cbor encode/decode, logger/runtime helpers). Duplicating this logic across repos causes drift and chain-inaccurate behavior.

## Users
- API services (`api.handle.me`, `auth.handle.me`, `minting.handle.me`, marketplace services).
- Internal automation and support tooling.
- Other `@koralabs/*` packages consuming shared types and helpers.

## Goals
- Provide one import surface for core Handle/Cardano primitives.
- Keep Handle formatting and policy logic deterministic across services.
- Provide reusable CBOR, crypto, and object utility helpers.
- Keep OAuth/repository contracts centralized for implementers.
- Maintain simple test and coverage guardrails (`npm test`, `./test_coverage.sh`).

## Non-Goals
- Service-specific persistence implementations.
- UI rendering logic.
- Deployment/runtime orchestration.

## Functional Requirements

### Shared Handle Domain Logic
- Export handle metadata helpers (`buildMetadata`, rarity/character derivation, pattern checks).
- Provide policy lookup helpers (`HANDLE_POLICIES`) for network-aware policy selection.
- Provide typed handle models/interfaces for API search, pagination, personalization, and datum structures.

### Runtime and Observability Helpers
- Provide `Logger` and `LogCategory` with local colorized logging and async environment bootstrap.
- Provide simple HTTP request/response wrappers with cookie parsing and cookie-setting helpers.
- Provide environment detection for Lambda/Fargate/EC2 and network resolution.

### Cardano/Data Utilities
- Provide address and asset-name helpers (bech32 decode/encode, CIP-67 label parsing, stake key extraction).
- Provide CBOR encode/decode helpers with schema-aware decoding options.
- Provide generic helpers (`diff`, async iteration utilities, slot/date conversion, map stringifiers).

### Safety and Policy Utilities
- Provide protected-word availability checks with number-replacement and phrase detection flows.
- Keep known-contract registry mapping available for address-owner attribution.

## Success Criteria
- Package exports remain type-safe and stable for downstream services.
- Docs describe all major module surfaces and expected runtime inputs.
- Coverage guardrail script enforces >=90% line and branch coverage.
