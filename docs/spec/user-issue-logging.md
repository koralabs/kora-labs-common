# USER_ISSUE Logging Contract

## Logger Category
- `LogCategory.USER_ISSUE` is the shared category for user-experienced issue events.

## Structured Logger Payload
- `Logger.log` supports:
  - `message: string`
  - `category?: LogCategory`
  - `event?: string`
  - `milliseconds?: number`
  - `count?: number`
  - `dimensions?: string[]`
  - `context?: Record<string, unknown>`
- `context` is serialized into the logger's single-line JSON output.

## Tracking ID Helpers
- `createUserIssueTrackingId()` builds IDs in format `UI-<base36Timestamp>-<base36Random6>`.
- `isUserIssueTrackingId(value)` validates the same format.
- `USER_ISSUE_TRACKING_ID_REGEX` is exported for direct format checks.

## Event Key Helpers
- `normalizeUserIssueEventSegment(value)` normalizes to `[a-z0-9_]+` tokens.
- `buildUserIssueEventKey(repo, flow, pathOrFunction, step)` builds deterministic keys:
  - `user_issue.<repo>.<flow>.<pathOrFunction>.<step>`
