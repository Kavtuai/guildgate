# Configuration reference

GuildGate keeps defaults small and lets the application decide storage, route layout, Discord access and presentation.

## `app`

- `name`: application name used in configuration and diagnostics
- `environment`: `development`, `test` or `production`
- `baseUrl`: canonical application URL

Production validation requires HTTPS URLs and rejects localhost origins.

## `owners`

Discord user IDs allowed to use owner actions. An empty list disables owner-only access. Keep this list in application configuration or a durable owner policy managed through a protected process.

## `locale`

- `default`: `en` or `tr`
- `messages`: per-locale error-message overrides keyed by error code

Error codes remain stable identifiers even when display text is replaced.

## `security.allowedOrigins`

An exact list of browser origins. Scheme, host and port must match. Do not put paths or wildcard hosts in this list.

## `security.session`

- `ttlMs`: absolute session lifetime
- `idleTimeoutMs`: inactivity lifetime
- `rotateAfterMs`: age that triggers a new opaque token
- `maximumSessionsPerUser`: active session cap

## `security.cookie`

Optional cookie overrides:

- `name`
- `path`
- `secure`
- `sameSite`
- `maxAgeSeconds`

Production defaults use a secure `__Host-` cookie name and path `/`.

## `stores`

The application supplies `GuildGateStores`. It may use one backend or combine multiple services with `composeStores()`.

Common split:

- PostgreSQL: sessions, credentials, audit, policies, outbox, analytics
- Redis: rates, cache, idempotency and leases

## `transactions`

Optional transaction adapter. An action with `transaction.required !== false` fails when the adapter is absent. Use the built-in PostgreSQL adapter or implement the transaction contract.

## `realtime`

Optional immediate publisher. Outbox delivery uses `stores.outbox`. Network transports use the separate realtime entry point.

## `telemetry`

Optional hooks for action spans, completion counters, duration histograms and exception records. `createOpenTelemetryHooks()` adapts an application-provided OpenTelemetry API.

## `audit`

- `enabled`: turn general action audit on or off
- `redactKeys`: application-specific secret field names
- `failClosedActions`: action names that return an error when general audit storage fails

Fail-closed general audit cannot roll back a domain commit. Store mandatory domain audit in the database transaction.

## Action-level choices

Each action can set authentication, CSRF, parsing, resource, rate limit, authorization, idempotency, optimistic revision, concurrency, retry, circuit breaker, transaction, timeout, cache, realtime and audit behavior.

Use a shared action factory in the application when many actions need the same policy.
