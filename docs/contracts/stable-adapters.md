# Stable adapter contracts

GuildGate keeps optional ecosystems behind compatibility interfaces. The public contract markers are:

```ts
adapterContractVersion = "1.0"
actionContractVersion = "1.0"
realtimeContractVersion = "1.0"
```

## Store contract

A `GuildGateStores` implementation supplies sessions, OAuth state, credentials, rate limits, cache, idempotency, locks, audit, outbox and policies. `runStoreContract()` checks core atomic behavior.

A custom adapter should run the contract against a clean namespace in CI. The contract does not test backend deployment, replication, failover or retention.

## Transaction contract

A transaction adapter must:

- commit only after the work function resolves
- roll back when the work function throws
- call post-commit callbacks only after commit
- call rollback callbacks after failure
- keep one raw backend context for nested store calls where supported

## Framework contract

Framework handlers translate requests into `RequestEnvelope` and translate `ActionResult` back to HTTP. The framework remains responsible for route registration, body limits, proxy trust and TLS.

## Realtime contract

A connection supplies send, close and optional buffered-byte information. The hub controls authorization and limits. The transport controls frame parsing, network heartbeat support and TLS.

## Compatibility testing

Before publishing an adapter:

1. run TypeScript against the oldest supported public declarations
2. run `runStoreContract()` when it implements stores
3. test cancellation and timeout behavior
4. test two concurrent processes when it claims shared work
5. document consistency and failure semantics
