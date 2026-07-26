# Configuration reference

GuildGate leaves database, routes, Discord access and UI decisions to the application.

## Application

`app` contains the name, environment and base URL. Production requires HTTPS. Allowed origins reject localhost, IPv4 loopback, IPv6 loopback, unspecified addresses and IPv4-mapped loopback hosts.

## Owners and locale

`owners` lists Discord user IDs allowed to call owner actions. An empty list disables owner access. The default locale can be `en` or `tr`; stable error codes remain unchanged when messages are overridden.

## Sessions and cookies

Configure total lifetime, idle lifetime, rotation interval and the per-user cap. Official stores apply the cap atomically. Expired and revoked session responses clear the cookie through Fastify, Express and Hono adapters.

Production defaults should use a secure `__Host-` cookie with path `/` and no domain attribute.

## Stores

Pass a complete `GuildGateStores` bundle or combine durable PostgreSQL and ephemeral Redis stores with `composeStores()`. Custom stores targeting adapter contract `1.1` should implement reservation ownership, atomic session creation and cursor audit paging.

## Actions

Each action can configure authentication, CSRF, parsing, resource resolution, rate limits, authorization, idempotency, revision checks, concurrency, retry, circuit breaker, transaction, timeout, cache, realtime and audit behavior.

An idempotency TTL must be longer than `timeoutMs`. Automatic retry should be limited to failures known to be safe for that operation. Generic `TypeError` values are not retryable by default.

## Transactions and fail-closed audit

A transaction adapter is optional. Domain rows and mandatory outbox records belong in the transaction. Post-commit observers are reported separately and do not cause rollback after commit. An action listed in `audit.failClosedActions` must enable auditing, idempotency and a required transaction. Its audit write runs before commit and the custom audit store must enlist in the same transaction as the domain write.

## Reliability

`reliability.maximumLateSettlementMs` defaults to five minutes and accepts values from 10 milliseconds through 24 hours. It bounds how long GuildGate observes a timed-out or cancelled operation while retaining its reservation and lease. Reaching the bound releases those resources; application code must honor `AbortSignal` and use fencing-aware durable writes to prevent a late stale worker from committing afterward.

## Realtime

Configure message bytes, message rate, channel length, subscription count, idle timeout, maximum lifetime, buffered bytes and session revalidation. WebSocket and Socket.IO client events share the hub guards.

## Audit and telemetry

Known secret fields are redacted and applications can add field names. An action can fail closed when general audit persistence is mandatory, but audit that must be atomic with the domain write should be written inside the transaction. Telemetry hooks connect to the application’s selected backend.
