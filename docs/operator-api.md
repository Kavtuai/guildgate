# Operator API

`createOperatorActions()` creates guarded actions for dashboard operators and bot owners. It does not register routes by itself.

## Session actions

- list the current user's sessions
- revoke one session
- revoke all other sessions

Returned session rows use public hashes and metadata rather than raw session tokens.

## Owner actions

- list audit records
- inspect maintenance, blocks and registered rate policies
- enable or disable maintenance mode
- block or unblock a user, guild or IP subject
- reset a registered rate key
- query analytics points

Owner identity comes from the `owners` list in `createGuildGate()`.

## Route policy

Use the normal HTTP adapter. Unsafe owner actions still need an authenticated owner session, an allowed origin, a CSRF token and any action rate rule. Audit the operator action and the affected subject.

## Pagination

Operator list actions use cursor pagination. The default page size is 50 and the maximum is 200. Do not expose an unbounded audit or session query.

## UI guidance

A session screen should show creation time, last activity, expiry and whether the row is the current session. A policy screen should show who changed a rule, when it changed and any expiry. A destructive button should require a clear confirmation but should not expose internal tokens or database keys.
