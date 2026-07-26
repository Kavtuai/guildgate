# Test report

Date: 2026-07-26
Package: `@kavtuai/guildgate@1.0.0`

## Toolchain

- Node.js: 22.16.0
- TypeScript: 5.8.3
- Platform: Linux x64
- Runtime dependencies in the core package: 0

## Release verification

`npm run release:verify` completed successfully. The task ran:

- strict TypeScript checking
- a clean TypeScript build
- repository writing rules
- 39 automated behavior and regression tests
- package security verification
- the local concurrency and latency harness
- npm package dry-run and file inspection

The security verifier checked 45 TypeScript source files, 16 public export paths, three CLI targets, OIDC release settings and common committed-credential patterns.

## Automated test result

| Result | Count |
|---|---:|
| Passed | 39 |
| Failed | 0 |
| Skipped | 0 |
| Cancelled | 0 |

Coverage includes:

- session and CSRF enforcement
- OAuth state binding and single use
- idempotency replay and conflicting payloads
- optimistic revision rejection
- transaction commit, rollback and hooks
- retry, deadline and circuit-breaker behavior
- renewable leases and fencing tokens
- cache tag invalidation
- owner maintenance, blocks, policy inspection and session revocation
- Discord permission calculation and discord.js-compatible authorization
- Fastify, Express and Hono compatibility boundaries
- authorized WebSocket replay, SSE behavior, revocation and heartbeat
- event sequencing, resume cursors and claimed outbox work
- PostgreSQL migration and transaction behavior
- Redis lease scripts
- status monitoring, analytics buckets, SVG charts and table models
- OpenTelemetry bridge callbacks
- CLI help and installed-directory behavior

Security regression coverage includes hidden error details, secret redaction, circular serialization, SVG injection, denied replay, malformed realtime JSON, unsafe action configuration, generic retry behavior, malformed encrypted tokens, Redis fencing and PostgreSQL idempotency races.

## Installed consumer test

A generated `kavtuai-guildgate-1.0.0.tgz` was installed into an empty project with lifecycle scripts disabled.

Verified results:

- all 16 public package subpaths imported
- `createGuildGate` and the testing harness were available
- an idempotent guarded write executed once and replayed its first result
- `guildgate-doctor --help` passed
- `guildgate-writing-check --help` passed
- `guildgate-migration --help` passed

Consumer result: `CONSUMER_TEST_PASSED`.

## Load reference

The latest local run executed 5,000 in-memory guarded writes with concurrency 10.

| Measurement | Result |
|---|---:|
| Domain executions | 5,000 |
| Failures | 0 |
| Duration | 274.59 ms |
| Throughput | 18,208.92 operations/second |
| p50 | 0.48 ms |
| p95 | 1.10 ms |
| p99 | 2.30 ms |

The scenario contains no network, Redis, PostgreSQL or Discord request. It is a regression baseline, not a production capacity claim.

## Live Discord path already exercised

The published `0.1.1` package was used in a separate Discord lab application. That run verified bot login, guild command registration, Discord OAuth callback, session creation, dashboard reads, owner maintenance actions and logout. The lab also exposed a Fastify type boundary issue, which was corrected in the lab adapter.

## Deployment tests left to the application

The source package cannot reproduce every target environment. Before production use, test:

- live Redis with at least two application instances
- live PostgreSQL migrations, fencing-aware writes and concurrent outbox workers
- real Discord permission loss, role changes and bot removal
- network interruption during a database transaction
- long-running WebSocket and SSE connections with slow clients
- the chosen OpenTelemetry SDK and exporter
- proxy trust, TLS, cookies, retention and backup behavior

The maintainer security review is recorded in `SECURITY_AUDIT.md`. It is not described as an independent third-party audit.
