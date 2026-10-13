# kora-labs-common canonical contract

**Status: proposal (ecosystem-ownership-plan row 5.3). Operator review pending.**

Shared library used by every service: logger, chain providers, MPT, cron lock, tx building, handle models. The code that holds the rules below is listed in [`.enclave`](./.enclave);
K.O.R.A.'s `merge_pr` asks the operator before a change to it merges into `master`.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root): "Critical Correctness" (addresses 100% correct, never
  double-mint, chain-accurate properties) and "Merging" (double-mint, contract/settings edits and
  automated burns need operator approval).
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2 (enclave = key/security material,
  prompt files, and the files that define, support or enforce this contract) and Phase 5 row 5.3
  ("every remaining repo, even if the enclave is empty; each AGENTS.md points at both").
- kora-bot `v3/docs/tool-surface.md` (`merge_pr`): cards enclave paths merged into
  `master`/`main`/`mainnet`/`preprod`, reading a root `.enclave`.
- Ecosystem `AGENTS.md` "Logging Rules", "Rate limits are law".

## Must never be violated

1. **Log levels keep their meaning**: WARN/ERROR/NOTIFY/FATAL reach the alert bridge; INFO never alerts.
2. **The cron lock and MPT helpers never let two mints run or a root drift**; the MPT is built from the API and checked against the chain root.
3. **Handle models and datum codecs are chain-accurate.**
4. **HTTP calls honour rate-limit signals.**
5. **No secrets in the repo.** Keys, tokens, mnemonics and `.env` values live in the box SOPS stores or local `.env.local.*` files, never in git or GitHub secrets copied from them.

## Where it is enforced today

| # | Code |
|---|---|
| 1 | `src/logger/` |
| 2 | `src/cronLock/cqlCronLock.ts`, `src/mpt/` |
| 3 | `src/handles/`, `src/chain/datum/` |
| 4 | `src/http/` |

## Refactor needed for enforcement

- Every enclaved app depends on these files through a package version bump; a version bump PR in an app does not touch its `.enclave`, so the gate must sit here.
