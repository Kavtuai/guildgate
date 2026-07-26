import type { MetricPoint, MetricQuery } from "./types.js";

export interface AnalyticsStore {
  write(point: MetricPoint): Promise<void>;
  writeMany(points: MetricPoint[]): Promise<void>;
  query(query: MetricQuery): Promise<MetricPoint[]>;
  deleteBefore?(timestamp: string, names?: string[]): Promise<number>;
}

export class MemoryAnalyticsStore implements AnalyticsStore {
  private readonly points: MetricPoint[] = [];

  async write(point: MetricPoint): Promise<void> {
    this.points.push(structuredClone(point));
  }

  async writeMany(points: MetricPoint[]): Promise<void> {
    this.points.push(...points.map((point) => structuredClone(point)));
  }

  async query(query: MetricQuery): Promise<MetricPoint[]> {
    const names = query.names ? new Set(query.names) : undefined;
    let rows = this.points.filter((point) => {
      if (names && !names.has(point.name)) return false;
      if (query.from && point.timestamp < query.from) return false;
      if (query.to && point.timestamp > query.to) return false;
      if (query.dimensions) {
        for (const [key, value] of Object.entries(query.dimensions)) {
          if (point.dimensions?.[key] !== value) return false;
        }
      }
      return true;
    });
    rows = rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (query.order === "desc") rows.reverse();
    return rows.slice(0, query.limit ?? 10_000).map((point) => structuredClone(point));
  }

  async deleteBefore(timestamp: string, names?: string[]): Promise<number> {
    const selected = names ? new Set(names) : undefined;
    let deleted = 0;
    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (point && point.timestamp < timestamp && (!selected || selected.has(point.name))) {
        this.points.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  inspect(): MetricPoint[] {
    return this.points.map((point) => structuredClone(point));
  }
}
