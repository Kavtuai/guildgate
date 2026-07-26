# PostgreSQL adapter

`createPostgresAdapter()` accepts a pool-like object. GuildGate does not import `pg`; the application selects and pins the client.

## Included records

Sessions, OAuth state, encrypted credentials, rate windows, cache, idempotency, lease locks, audit, policies, outbox, analytics and realtime sequence records are included.

## Migration

```bash
npx guildgate-migration --prefix guildgate > guildgate.sql
```

Review the SQL and apply it through the application migration system. Do not start the same migration from every application process.

## Transaction behavior

`AsyncLocalStorage` keeps store calls on the transaction client. Root work uses `BEGIN` and `COMMIT`; nested work uses unique `SAVEPOINT` names. A nested error rolls back to its savepoint. Post-commit observers run only after the outer commit and cannot trigger a rollback.

## Session cap

Session creation takes a transaction-scoped advisory lock derived from the user ID, inserts the new record and removes rows beyond `maximumSessionsPerUser`. This serializes the invariant across instances without storing raw session tokens.

## Rate limits

Rate-limit bucket updates take a transaction-scoped advisory lock derived from the bucket key before reading and upserting the row. This prevents concurrent first hits from being lost when the bucket does not yet exist.

## Idempotency

The first reservation uses `INSERT ... ON CONFLICT DO NOTHING`. Completion and cleanup include `state='inflight'` and `reservationId` in the predicate. A stale worker receives `false` and cannot overwrite a newer owner.

## Audit paging

Audit pages use `ORDER BY created_at DESC, id DESC`. The opaque cursor is applied as a row comparison in SQL, so equal timestamps do not duplicate or hide rows.

## Outbox claims

Workers claim unpublished rows with `FOR UPDATE SKIP LOCKED` and a claim lease. Delivery remains at-least-once; consumers deduplicate by event ID.

## Live service test

The repository CI starts disposable PostgreSQL and runs transaction, savepoint, reservation, session-cap and audit-pagination tests through the public adapter.
