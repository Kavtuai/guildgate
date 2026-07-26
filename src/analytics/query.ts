import type { MetricBucket, MetricPoint } from "./types.js";

export function bucketMetrics(points: MetricPoint[], bucketMs: number): MetricBucket[] {
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) throw new TypeError("bucketMs must be positive");
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    const timestamp = new Date(point.timestamp).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const start = Math.floor(timestamp / bucketMs) * bucketMs;
    const values = buckets.get(start) ?? [];
    values.push(point.value);
    buckets.set(start, values);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, values]) => summarizeBucket(start, bucketMs, values));
}

export function summarizeMetric(points: MetricPoint[]): Omit<MetricBucket, "start" | "end"> {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const bucket = summarizeBucket(0, 1, values);
  const { start: _start, end: _end, ...summary } = bucket;
  return summary;
}

export function buildAnalyticsTable(input: {
  title?: string;
  columns: Array<{ key: string; label: string; format?: (value: unknown, row: Record<string, unknown>) => string }>;
  rows: Array<Record<string, unknown>>;
}): { title?: string; columns: string[]; rows: string[][] } {
  return {
    ...(input.title ? { title: input.title } : {}),
    columns: input.columns.map((column) => column.label),
    rows: input.rows.map((row) => input.columns.map((column) => {
      const value = row[column.key];
      return column.format ? column.format(value, row) : value === undefined || value === null ? "" : String(value);
    })),
  };
}

function summarizeBucket(start: number, bucketMs: number, values: number[]): MetricBucket {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + bucketMs).toISOString(),
    count: sorted.length,
    sum,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    average: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index] ?? 0;
}
