# Release plan

The ZIP contains the complete `0.1.0` source, build output, tests, examples, documentation, UML, and release configuration. Later versions below are planned releases, not copied or simulated source trees.

## 0.1.x: Initial contract stabilization

- Fix defects found during local Fastify, Express, Discord OAuth, Redis, and custom database integration.
- Add contract tests that adapter authors can run against their stores.
- Freeze error codes and document migration rules.
- Add request cancellation tests for supported clients.

Exit condition: two example applications pass login, settings write, permission revocation, session revocation, and outbox tests.

## 0.2.0: Durable adapter set

- Official PostgreSQL adapter with migrations and transaction examples.
- Official MongoDB adapter where equivalent atomic operations are available.
- Optional SQLite adapter for single-instance tools.
- Redis lease renewal and a fencing-token option.
- Outbox row claiming for multiple workers.

Exit condition: concurrency tests run against each official adapter in CI.

## 0.3.0: Realtime transport adapters

- `ws` adapter.
- Socket.IO adapter.
- Server-Sent Events adapter for server-to-browser updates.
- Session revocation broadcast between application instances.
- Event sequence and resume cursor support.

Exit condition: reconnect, revocation, backpressure, and duplicate-delivery tests pass under multiple instances.

## 0.4.0: Operator tools

- Policy inspection API.
- Read-only owner console example.
- Session and audit query helpers with pagination.
- OpenTelemetry hooks without forcing one telemetry backend.
- Rate policy inspection and safe reset commands.

Exit condition: operator actions are covered by owner authorization, CSRF, rate limits, and audit tests.

## 1.0.0: Stable public API

- External security review or documented independent review process.
- Stable storage, action, Discord, framework, and realtime contracts.
- Upgrade guide from all pre-1.0 releases.
- Load test results and stated operating limits.
- Supported-version policy and security response targets.
- No known high-severity issue at release time.

The project will not advertise “zero vulnerabilities” or “bug-free” status. Security statements will describe tested behavior and known limits.
