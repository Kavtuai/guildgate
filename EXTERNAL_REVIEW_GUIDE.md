# External review guide

This document defines a practical handoff for an independent review. It does not state that an external audit has already occurred.

## Review target

- package: `@kavtuai/guildgate@1.1.1`
- runtime: Node.js 22 and 24
- adapter contract: `1.1`
- action contract: `1.0`
- realtime contract: `1.0`

## High-value review paths

1. Session token creation, rotation, revocation and cookie clearing.
2. CSRF, exact-origin and production loopback validation.
3. Idempotency reservation ownership and late-settlement replay.
4. Transaction finality, nested savepoints and post-commit failures.
5. Redis lease renewal, fencing tokens, cache tag Lua scripts and session caps.
6. PostgreSQL advisory locking, reservation predicates, cursor queries and outbox claims.
7. WebSocket, Socket.IO and SSE authorization, replay, rate, size and backpressure controls.
8. Error redaction, audit redaction, SVG output and bounded serialization.
9. Package exports, CLI entry points, GitHub OIDC publication and provenance.

## Reproduction commands

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
npm run security:verify
npm run test:load
npm pack --dry-run
```

For live stores, run the `service-integration` GitHub Actions job or provide disposable PostgreSQL and Redis services, install compatible `pg` and `redis` clients in the test workspace, and run:

```bash
GUILDGATE_SERVICE_TESTS=1 npm run test:services
```

## Evidence to retain

- exact commit and package tarball integrity
- Node.js and service versions
- test and coverage output
- migration SQL reviewed
- findings with severity, affected paths and reproduction
- remediation commit and retest result

## Boundaries

The reviewer should separate package defects from consuming-application policy. GuildGate cannot determine whether a Discord role should authorize a product action, whether a reverse proxy forwards trustworthy client IP information or whether an application consumer handles outbox events idempotently.
