# Independent review handoff

This document gives an external reviewer a compact starting point. It does not claim that an independent review has already taken place.

## Review target

- package: `@kavtuai/guildgate@1.0.0`
- runtime: Node.js 22 or newer
- source archive and npm tarball produced from the same release commit
- public contract markers: action `1.0`, store `1.0`, realtime `1.0`

## Priority paths

Review these paths first:

1. `src/kernel.ts`: action order, authorization, idempotency, transactions, locks, audit and error responses
2. `src/session.ts` and `src/security.ts`: token handling, cookies, origin and CSRF checks
3. `src/discord/oauth.ts`: state binding, callback validation and credential storage
4. `src/realtime/`: subscription authorization, replay, revocation, backpressure and outbox delivery
5. `src/postgres.ts` and `src/redis.ts`: atomicity, leases, fencing, claims and expiration
6. `src/operator.ts`: owner boundaries and public session data
7. `src/analytics/charts.ts`: untrusted labels and theme values in SVG output
8. `.github/workflows/publish.yml`: release identity, OIDC and provenance

## Abuse cases

- replay a consumed OAuth state from another browser
- send an unsafe request without the expected origin or CSRF token
- reuse an idempotency key with a different body
- race two first-use idempotency reservations
- keep writing after a lease expires and another worker receives a newer fence
- request retained realtime events after subscription denial
- revoke a session while the user has open WebSocket and SSE connections
- send malformed JSON, oversized channels and slow-consumer traffic
- inject markup through chart labels, colors, fonts or titles
- trigger hidden application errors containing token-shaped fields
- return custom session metadata that contains private application fields

## Evidence to record

A useful review report should include:

- reviewed commit and package integrity value
- tools and manual methods used
- finding identifier, severity, impact and reproduction
- fixed commit and regression test
- unresolved assumptions or deployment-specific requirements
- reviewer name, organization and review date

Private findings should use GitHub private vulnerability reporting. Real tokens, user records and production credentials must not be placed in the report.
