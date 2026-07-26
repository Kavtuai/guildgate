import type { RealtimeEvent } from "../types.js";

export interface RealtimeEventLog {
  append(event: RealtimeEvent): Promise<RealtimeEvent>;
  replay(channel: string, afterSequence: number, limit: number): Promise<RealtimeEvent[]>;
  latestSequence(channel: string): Promise<number>;
  trim?(channel: string, beforeSequence: number): Promise<number>;
}

export class MemoryRealtimeEventLog implements RealtimeEventLog {
  private readonly sequences = new Map<string, number>();
  private readonly events = new Map<string, RealtimeEvent[]>();

  constructor(private readonly maximumEventsPerChannel = 5_000) {}

  async append(event: RealtimeEvent): Promise<RealtimeEvent> {
    const sequence = (this.sequences.get(event.channel) ?? 0) + 1;
    this.sequences.set(event.channel, sequence);
    const sequenced = structuredClone({ ...event, sequence });
    const rows = this.events.get(event.channel) ?? [];
    rows.push(sequenced);
    if (rows.length > this.maximumEventsPerChannel) rows.splice(0, rows.length - this.maximumEventsPerChannel);
    this.events.set(event.channel, rows);
    return structuredClone(sequenced);
  }

  async replay(channel: string, afterSequence: number, limit: number): Promise<RealtimeEvent[]> {
    return (this.events.get(channel) ?? [])
      .filter((event) => (event.sequence ?? 0) > afterSequence)
      .slice(0, Math.max(0, limit))
      .map((event) => structuredClone(event));
  }

  async latestSequence(channel: string): Promise<number> {
    return this.sequences.get(channel) ?? 0;
  }

  async trim(channel: string, beforeSequence: number): Promise<number> {
    const rows = this.events.get(channel) ?? [];
    const kept = rows.filter((event) => (event.sequence ?? 0) >= beforeSequence);
    this.events.set(channel, kept);
    return rows.length - kept.length;
  }
}

export function createSequencedPublisher(input: {
  log: RealtimeEventLog;
  publish: (event: RealtimeEvent) => Promise<void>;
}): { publish(event: RealtimeEvent): Promise<void> } {
  return {
    async publish(event) {
      const sequenced = await input.log.append(event);
      await input.publish(sequenced);
    },
  };
}
