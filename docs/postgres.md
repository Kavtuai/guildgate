# PostgreSQL adapter

`createPostgresAdapter()` accepts a pool-like object. The package does not import `pg`, so the application selects and pins its driver.

## Included records

- sessions
- OAuth state and encrypted credential records
- rate-limit windows
- cache and cache tags
- idempotency state
- lease locks and fencing sequence
- audit events
- maintenance and block policies
- outbox rows and claim leases
- analytics points
- realtime sequences and event rows

## Migration

Print migration SQL:

```bash
npx guildgate-migration --prefix guildgate
```

Review the SQL and execute it through the application migration system. The prefix is validated and used only for generated identifiers.

## Transaction scope

The adapter uses `AsyncLocalStorage` so store methods called inside a transaction use the same client. Nested calls reuse the current transaction scope.

## Outbox claims

Workers claim unpublished rows in a transaction. The query locks selected rows and skips rows already locked by another worker. A claim expiry lets another worker recover work after a crash.

Event delivery should remain idempotent because a process can publish successfully and fail before marking the row.

## Pool guidance

- reserve enough pool connections for application traffic and outbox workers
- set statement timeouts for guarded writes
- keep migrations outside normal application startup races
- index application tables used by optimistic revision checks
- apply retention to metrics and realtime events
- test failover and connection exhaustion in staging
