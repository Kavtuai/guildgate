# Monitoring and analytics

GuildGate provides data collection and rendering primitives. It does not choose a dashboard framework or a long-term retention policy.

## Status monitor

`StatusMonitor` samples process metrics, optional Discord bot state and application-defined probes. It writes points through `AnalyticsStore` and can pass a combined snapshot to `onSnapshot`.

Built-in process metrics:

- process uptime
- RSS, heap and external memory
- event-loop delay
- user and system CPU time

The discord.js-compatible collector can read:

- ready state
- gateway latency
- guild count
- summed member reach
- shard count
- application command count
- bot uptime

## Probes

A probe receives an `AbortSignal` and returns `operational`, `degraded`, `outage` or `unknown`. Common probes include PostgreSQL, Redis, Discord REST, a job queue and an external dependency.

## Storage

`MemoryAnalyticsStore` is for local development and tests. The PostgreSQL adapter stores time-series points with JSON dimensions. Custom adapters can send points to an existing metrics database.

Apply retention with `deleteBefore()` and keep dimension cardinality bounded. Avoid user IDs or request IDs as metric dimensions unless the backend is designed for that scale.

## Queries and summaries

`bucketMetrics()` groups points by a fixed time window. Each bucket contains count, sum, minimum, maximum, average, p50, p95 and p99. `summarizeMetric()` produces the same summary for one set.

## Charts

- `renderLineChartSvg()` for time series
- `renderBarChartSvg()` for grouped comparisons
- `renderDonutChartSvg()` for small part-to-whole views

The functions return standalone SVG strings. Treat chart titles and labels as application data; the renderer XML-escapes them.

## Tables

`buildAnalyticsTable()` returns a title, column labels and formatted rows. Applications can expose it as JSON or render it with React, Vue, Svelte or server HTML.

## Suggested dashboard panels

- gateway latency p50/p95/p99
- event-loop delay
- heap and RSS
- bot readiness and shard count
- guild count and user reach
- API and database probe state
- action error count by error code
- rate-limit rejections
- outbox backlog and oldest row age
- active sessions and revocations
