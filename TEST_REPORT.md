# Test report

Date: 2026-07-26
Package: `@kavtuai/guildgate@1.1.0`

## Toolchain

- Local final verification: Node.js 24.12.0
- TypeScript: 5.8.3
- Platform: Windows x64
- CI matrix: Node.js 22 and 24
- Runtime dependencies in the core package: 0
- Public export paths: 16
- CLI targets: 3

## Release verification

`npm run release:verify` completed successfully from a clean build. It ran strict TypeScript checking, the writing policy, deterministic tests, enforced coverage thresholds, source and package security checks, the in-memory load harness and npm package inspection.

The security verifier checked 46 TypeScript source files, all 16 public export paths, all three CLI targets, the OIDC release workflow, the adapter contract version and committed credential patterns.

## Automated test result

The repository test command loads the two live-service test definitions but skips them unless service credentials are present.

| Result | Count |
|---|---:|
| Passed | 76 |
| Failed | 0 |
| Skipped locally | 2 |
| Cancelled | 0 |

The deterministic suite covers:

- session, cookie, exact-origin and CSRF enforcement
- OAuth state binding, encrypted credentials, distributed refresh single-flight and production URL rejection
- idempotency ownership, renewal, replay, changed payloads and late completion
- hard response deadlines, cancellation and bounded late settlement
- optimistic revisions, renewable leases and fencing tokens
- transaction finality, nested PostgreSQL savepoints and fail-closed audit ordering
- atomic memory session caps and store contract invariants
- PostgreSQL rate-limit serialization and Redis atomic scripts through adapter regression tests
- cache stampede handling, fallback persistence, tag retagging and expiry
- opaque audit cursor paging and malformed cursor rejection
- Discord permission calculation, guild authorization and discord.js adapter behavior
- Fastify, Express and Hono response boundaries
- WebSocket, Socket.IO and SSE authorization, replay, rate, size, activity and backpressure controls
- subscription authorization races, broken connection cleanup and revocation listener isolation
- sequenced events, outbox claims, worker overlap prevention and sanitized publisher errors
- operator policy controls, monitoring, analytics, SVG safety and telemetry bridges
- CLI portability and installed-directory behavior

## Repeated stability pass

After the original timing-sensitive assertion was identified under coverage instrumentation, the idempotency-renewal test was rewritten around a controlled execution gate. It now verifies ownership after the original TTL has elapsed, releases the domain operation deliberately and polls the public replay result within a bounded deadline.

The focused reliability suite was then executed five consecutive times. Every run reported 33 passed, 0 failed, 0 skipped and 0 cancelled. The complete release verification was run afterward and reported 76 deterministic tests passed, 0 failed and two live-service definitions skipped locally.

Coverage test files execute with `--test-concurrency=1`. This keeps instrumentation overhead from turning lease-renewal behavior into a machine-speed-dependent assertion.

## Coverage

`npm run test:coverage` executes the 76 deterministic tests through Node.js native coverage. Release verification fails below 80% lines, 70% branches or 70% functions.

| Metric | Result | Required |
|---|---:|---:|
| Lines | 82.25% | 80% |
| Branches | 73.57% | 70% |
| Functions | 73.30% | 70% |

## Live-service test definitions

`tests/service-integration.test.mjs` contains two tests designed for disposable services in GitHub Actions:

- PostgreSQL 17: migration, root and nested transaction behavior, idempotency ownership, concurrent session cap, exact concurrent rate limiting and full audit traversal
- Redis 8: atomic session cap, cache retagging and TTL behavior, reservation renewal and stale-owner rejection

They are enabled with `GUILDGATE_SERVICE_TESTS=1`, `POSTGRES_URL` and `REDIS_URL`. The local artifact container did not provide PostgreSQL or Redis daemons, so these two definitions were skipped locally rather than represented as live-service passes.

## Installed consumer test

A generated `kavtuai-guildgate-1.1.0.tgz` was installed into an empty project with lifecycle scripts disabled.

Verified results:

- all 16 public package subpaths imported
- all three CLI `--help` commands exited successfully
- the testing harness created a session
- an idempotent guarded write executed once and replayed its stored result

Consumer result: `CONSUMER_TEST_PASSED`.

## Load reference

The final release-verification run executed 5,000 in-memory guarded writes with concurrency 16.

| Measurement | Result |
|---|---:|
| Domain executions | 5,000 |
| Failures | 0 |
| Duration | 604.254 ms |
| Throughput | 8,274.67 operations/second |
| p50 | 1.69 ms |
| p95 | 3.18 ms |
| p99 | 5.58 ms |

This scenario contains no network, Redis, PostgreSQL or Discord request. It is a same-machine regression baseline, not a production capacity commitment.

## Package inspection

The npm dry-run included 241 files. The core package has no runtime dependencies. Build output, declaration files, source maps, documentation, examples, reports and CLI targets were included; `.env`, repository metadata, local `node_modules`, nested archives and credentials were excluded from the final source archive.

## Review boundary

This report records maintainer verification, not an independent third-party certification. A consuming application still needs deployment tests for its proxy, TLS, database permissions, Discord configuration, custom authorization, retention, backups and incident response.
