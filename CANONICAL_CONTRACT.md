# kora-labs-common canonical contract

Shared Handle types and codecs, chain transport, transaction and wallet primitives, and cron coordination. Consumers keep responsibility for their own business authorization and chain verification.

1. Cron coordination admits one authorized worker: unique ownership tokens, conditional release, and an unknown or ambiguous acquisition or renewal is never permission to work.
2. A provider's stated wait is recorded for the whole lifecycle (dispatch, headers, body, queued callers) and never shortened by retry, redirect, timeout or a new call. A 429 without a stated wait is not permission to retry blindly.
3. Network, policy, address, asset identity and quantity, datum and input references survive provider conversion, wallet parsing and codecs unchanged. Malformed responses never produce an invented absence, success or recipient.
4. Witness merging preserves the transaction body, id and script witness bytes; finalization preserves caller-fixed inputs and correct redeemer ordering.
5. Read-only wallet guards reject fund-moving calls (`signTx`, `signTxs`, `submitTx`); other methods such as `signData` pass through. Server-only modules stay out of the root browser barrel. Retired encrypted-setting hydration and ambient AWS discovery are rejected; R2 and public-URL configuration is explicit.
