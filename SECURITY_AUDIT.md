# Maintainer security and reliability review

Date: 2026-07-26
Reviewed version: `@kavtuai/guildgate@1.1.0`

## Scope

This review covers the action kernel, session and OAuth handling, HTTP adapters, transaction boundaries, idempotency, distributed leases, Redis and PostgreSQL stores, realtime transports, outbox workers, operator responses, analytics output, package exports, release automation and source archive contents.

The work was performed as a maintainer code review and regression pass. It is not an independent third-party audit or a formal assurance certificate.

## Method

The review combined:

- source-level data-flow and failure-path analysis
- concurrency analysis for transactions, reservations, leases, sessions, rate limits and outbox claims
- malformed input and production configuration tests
- transport parity tests for WebSocket, Socket.IO and SSE
- package-consumer installation and every public export import
- enforced Node.js line, branch and function coverage thresholds
- Coverage test files execute serially so instrumentation does not distort deadline and lease-renewal timing
- source, workflow, package identity and credential-pattern checks
- a bounded in-memory load regression

## Findings closed in 1.1.0

| ID | Severity | Area | Correction |
|---|---|---|---|
| GG-110-001 | High | Transaction finality | A successful `COMMIT` is separated from post-commit callbacks. Callback failure cannot trigger rollback callbacks or repeat a committed domain operation. |
| GG-110-002 | High | Idempotency ownership | Inflight records carry `reservationId`; renew, complete and fail use atomic owner comparison in memory, Redis and PostgreSQL. |
| GG-110-003 | High | Deadline behavior | The response deadline returns promptly even when application code ignores cancellation. Late settlement is observed within a configured bound and committed idempotent results are retained for replay. |
| GG-110-004 | High | Mandatory audit | Configured fail-closed audit writes occur before commit and require auditing, idempotency and a required transaction. |
| GG-110-005 | Medium | PostgreSQL nesting | Nested work uses savepoints. Inner rollback is limited to its savepoint and successful callback registration joins the outer transaction. |
| GG-110-006 | Medium | PostgreSQL rate limits | Bucket updates take a transaction-scoped advisory lock, preventing concurrent first-hit loss. |
| GG-110-007 | Medium | Redis cache indexes | Retagging, stale membership removal and deletion are atomic Lua operations; tag indexes receive bounded TTLs. |
| GG-110-008 | Medium | Session cap | Official memory, Redis and PostgreSQL stores enforce the per-user session cap within the store operation. |
| GG-110-009 | Medium | OAuth refresh | Discord refresh is protected by a distributed single-flight lease and credentials are re-read after ownership is acquired. |
| GG-110-010 | Medium | Realtime parity | Socket.IO uses shared size, rate, activity, subscription and backpressure checks. Capacity is rechecked after asynchronous authorization. |
| GG-110-011 | Medium | Realtime failure cleanup | Send failures close and remove broken connections. Revocation listener failures are isolated. |
| GG-110-012 | Medium | Outbox bounds | Batch size, concurrency and claim lease are bounded; stored publisher errors are newline-normalized and truncated. |
| GG-110-013 | Medium | Audit paging | Opaque `(createdAt, id)` cursors allow complete stable traversal and reject malformed or oversized cursors. |
| GG-110-014 | Medium | Production endpoints | Application, origin and Discord OAuth URLs reject loopback, unspecified and insecure production endpoints. |
| GG-110-015 | Low | HTTP cleanup | Expired and revoked session results carry cookie-clear metadata through Fastify, Express and Hono adapters. |
| GG-110-016 | Low | Adapter method binding | Official memory, Redis, PostgreSQL and discord.js adapter methods remain safe when passed as standalone callbacks. |

The review also rechecked earlier protections for authorized replay, hidden error details, secret redaction, bounded serialization, token authentication, SVG injection, retry defaults and malformed realtime messages.

## Verification result

At the end of this maintainer pass:

- 76 deterministic tests passed
- 0 deterministic tests failed
- 2 live-service definitions were skipped locally and remain enabled in CI
- line coverage: 82.25%
- branch coverage: 73.57%
- function coverage: 73.30%
- 46 source files and 16 public export paths passed the release security verifier
- 5,000 load-harness operations completed with 0 failures
- a clean consumer installed the tarball and imported every public subpath

Two live-service test definitions are present for disposable PostgreSQL 17 and Redis 8 services. They were not executed in the local artifact container because those daemons were unavailable; CI is configured to execute them with real services.

## Explicit operating boundaries

- JavaScript cannot forcibly terminate arbitrary application promises. `maximumLateSettlementMs` bounds GuildGate resource retention; application code must honor `AbortSignal` and durable writes must reject stale fencing tokens.
- Transactional outbox delivery is at-least-once. Consumers must deduplicate event IDs.
- A custom fail-closed audit store must enlist in the same transaction as the domain write.
- Custom adapters must satisfy contract `1.1`, including reservation ownership, atomic session limits and cursor paging.
- Application security still depends on TLS, proxy trust, database roles, secret storage, Discord permissions, custom authorization, retention and incident response.

## Status

No known release-blocking finding remained after this maintainer review and regression pass. That statement describes the findings discovered and tested in this scope; it does not claim that undiscovered defects are impossible. `EXTERNAL_REVIEW_GUIDE.md` remains the handoff for an independent assessment.
