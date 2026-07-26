export type MetricValue = number;
export type MetricKind = "gauge" | "counter" | "histogram";

export interface MetricPoint {
  name: string;
  value: MetricValue;
  kind: MetricKind;
  timestamp: string;
  dimensions?: Record<string, string>;
}

export interface MetricQuery {
  names?: string[];
  from?: string;
  to?: string;
  dimensions?: Record<string, string>;
  limit?: number;
  order?: "asc" | "desc";
}

export interface MetricBucket {
  start: string;
  end: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  average: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface StatusComponent {
  id: string;
  label: string;
  status: "operational" | "degraded" | "outage" | "unknown";
  latencyMs?: number;
  message?: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StatusSnapshot {
  id: string;
  status: StatusComponent["status"];
  checkedAt: string;
  components: StatusComponent[];
  metadata?: Record<string, unknown>;
}

export interface BotSnapshot {
  botId?: string;
  ready: boolean;
  websocketPingMs?: number;
  guildCount?: number;
  userReach?: number;
  shardCount?: number;
  commandCount?: number;
  uptimeMs?: number;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ServerSnapshot {
  processUptimeMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  eventLoopDelayMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  loadAverage?: number[];
  checkedAt: string;
}
