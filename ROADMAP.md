# Release plan and completion status

GuildGate tracks work by public capability. Version `1.0.0` contains the safe-write, realtime, adapter, operator, monitoring and analytics work planned for the first stable contract line.

## 0.1.x — Core security contracts

Completed and published through `0.1.1`:

- server-side session lifecycle
- Discord OAuth state and browser binding
- exact-origin and CSRF validation
- application-owned storage interfaces
- memory and Redis stores
- Fastify and Express handlers
- Discord permission helpers
- audit, cache, rate limit, idempotency and basic outbox behavior

## 0.2.0 — Reliable writes

Completed in the `1.0.0` code line:

- idempotency reservation, replay and payload conflict checks
- optimistic revision checks
- transaction adapters with commit and rollback hooks
- tag-based cache invalidation
- renewable distributed leases and fencing tokens
- deadlines, retry policies and circuit breakers
- owner maintenance and block controls
- session listing, revocation and owner API actions

## 0.3.0 — Realtime delivery

Completed in the `1.0.0` code line:

- WebSocket-compatible adapter
- Socket.IO-compatible adapter
- Server-Sent Events stream
- authorization for each channel subscription
- heartbeat and session revalidation
- session revocation disconnect and broadcast bus contract
- byte and queue backpressure limits
- per-channel event sequences and resume cursors
- claim-based outbox workers for multiple instances

## 0.4.0 — Ecosystem and operations

Completed in the `1.0.0` code line:

- Fastify, Express and Hono handlers
- PostgreSQL storage and migration SQL
- Redis short-lived stores
- discord.js-compatible adapter
- memory testing harness and adapter contract runner
- doctor, writing-check and migration commands
- OpenTelemetry bridge hooks
- owner policy, rate policy, audit and session inspection actions
- server and Discord bot status sampling
- time-series analytics, summaries, SVG charts and table models

## 1.0.0 — Stable contracts

Completed release gates:

- stable action, store and realtime contract markers
- documented migration and deprecation policy
- threat model and private security response process
- maintainer security audit with closed release-blocking findings
- regression coverage for audit findings
- Node.js 22 and 24 CI targets
- package, installed-consumer and CLI checks
- local concurrency and latency harness with stated limits
- OIDC trusted publishing and npm provenance

An independent assessment is recommended for deployments that need third-party assurance. The handoff scope is in `EXTERNAL_REVIEW_GUIDE.md`. It is not presented as work already performed.

Future minor releases will focus on measured adapter improvements, more live integration fixtures and operational tooling without changing the `1.0` contract line unnecessarily.
