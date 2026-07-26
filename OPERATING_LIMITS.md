# Operating limits

The values here are defaults or local reference measurements. Database latency, Discord traffic, application handlers, process limits and transport libraries change the result in production.

## Default guardrails

| Area | Default or hard limit |
|---|---:|
| Analytics query limit | 10,000 points; PostgreSQL hard cap 100,000 |
| Realtime adapter replay limit | 500 events unless configured |
| PostgreSQL replay hard cap | 5,000 events per query |
| SSE buffered event limit | 128 unless configured |
| Status monitor minimum interval | 1,000 ms |
| Health probe timeout | 5,000 ms unless configured |
| Operator page size | 50 by default, 200 maximum |
| PostgreSQL table prefix | 1–41 letters, numbers or `_`; must start with a letter |

Action deadlines, rate limits, lease duration, replay limits and socket caps must be selected from measured application behavior.

## Local reference run

`node scripts/load-test.mjs --operations 5000 --concurrency 10` produced this result on Node.js 22.16.0, linux x64, with 5 reported CPUs:

| Measurement | Result |
|---|---:|
| Operations | 5,000 |
| Concurrency | 10 |
| Failures | 0 |
| Duration | 274.59 ms |
| Throughput | 18,208.92 operations/second |
| p50 | 0.48 ms |
| p95 | 1.10 ms |
| p99 | 2.30 ms |

This is an in-memory action workload with unique idempotency keys and shared resource locks. It contains no network, Redis, PostgreSQL or Discord call. `LOAD_TEST_REPORT.json` contains the machine-readable result.

## Production test matrix

Before a production release, run separate tests for:

- single-instance development mode
- Redis-backed shared sessions, limits, idempotency and leases
- PostgreSQL transactions and outbox claims
- two or more application instances
- network interruption during a write
- worker crash after outbox claim
- WebSocket reconnect with a resume cursor
- slow SSE and WebSocket consumers
- Discord gateway reconnect and permission loss
- database failover and connection-pool exhaustion

## Sizing rules

- Keep the lock TTL above expected write time and renew before the lease reaches its final half.
- Include the fencing token in the database update when a stale lock holder may still reach storage.
- Keep status sampling slower than the slowest probe and prevent overlapping samples.
- Apply retention to metric points and realtime event logs.
- Partition or archive audit records when query time grows.
- Keep realtime payloads small; send record references for large data.
- Use separate rate keys for user, guild, IP and expensive upstream routes where needed.
- Cap analytics queries and chart ranges before exposing them to dashboard users.

## Release gate

A production capacity statement needs results from the target database, Redis setup, Node.js version, instance count and deployment region. The bundled report proves that the harness runs and supplies a baseline for later comparison only.
