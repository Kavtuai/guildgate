# Migration policy

## Versioning

GuildGate follows Semantic Versioning from `1.0.0`.

- Patch releases correct behavior without intentionally changing public contracts.
- Minor releases may add optional fields, exports and adapter capabilities.
- Major releases may remove or change public contracts after documented migration guidance.

## Stable contract markers

The package exports `adapterContractVersion`, `actionContractVersion` and `realtimeContractVersion`. Each value is currently `"1.0"`. Custom adapters should record the contract they implement and run `runStoreContract()` in CI.

## Upgrade sequence

1. Read the changelog and this file.
2. Install the target version in a branch.
3. Run TypeScript checks and the application test suite.
4. Run the store contract against every custom store.
5. Print and review PostgreSQL migration SQL before execution.
6. Test login, writes, session revocation, permission loss and realtime reconnect outside production.
7. Deploy one instance first when changing durable adapters.
8. Watch audit, outbox, rate and error metrics before completing rollout.

## From 0.1.1 to 1.0.0

### Actions and writes

Existing action definitions remain recognizable, while the stable line adds optional optimistic checks, transactions, retries, circuit breakers and renewable leases. Action context can expose the retry attempt, transaction scope and fencing token.

Hidden server errors no longer return internal `details`. Applications that intentionally expose structured details must use an exposed GuildGate error and avoid secrets.

The default retry rule no longer retries a generic `TypeError`. Supply `shouldRetry` only when the operation is known to be safe to repeat.

### Locks

Custom lock stores may keep basic acquire and release behavior. Renewal and fencing use `LeaseLockStore`. Redis now implements renewable leases and increasing fencing tokens. Storage writes must compare the fence when an expired worker may still reach the database.

### Operator sessions

Operator session responses omit stored metadata by default. Applications that need public metadata must provide `sessionMetadata` and return only approved fields.

### Outbox and realtime

Multi-worker deployments should implement outbox claims and use `createOutboxWorker()`. Realtime replay requires an event log and a client sequence cursor. Replay is sent only after the requested channel has been authorized.

### PostgreSQL

Print SQL first:

```bash
npx guildgate-migration --prefix guildgate > guildgate.sql
```

Apply schema changes with the application migration tool. Do not run the same migration concurrently from every application instance.

## Deprecation policy

A public contract scheduled for removal will normally remain available for at least one minor release. A direct security risk may require a shorter period, which will be documented in the security advisory and changelog.

## Rollback

Code rollback does not imply schema rollback. Before a migration, take a tested backup, verify whether old code can read the new schema and delay destructive changes until the compatibility period ends.
