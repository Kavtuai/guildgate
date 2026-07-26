import { monitorEventLoopDelay } from "node:perf_hooks";
import { loadavg } from "node:os";
import type { AnalyticsStore } from "./store.js";
import type { BotSnapshot, MetricPoint, ServerSnapshot, StatusComponent, StatusSnapshot } from "./types.js";

export interface StatusProbe {
  id: string;
  label: string;
  timeoutMs?: number;
  check(signal: AbortSignal): Promise<Omit<StatusComponent, "id" | "label" | "checkedAt">>;
}

export interface BotStatusCollector {
  collect(): Promise<Omit<BotSnapshot, "checkedAt">> | Omit<BotSnapshot, "checkedAt">;
}

export interface MetricCollector {
  id: string;
  collect(checkedAt: string, signal: AbortSignal): Promise<MetricPoint[]> | MetricPoint[];
}

export interface StatusMonitorOptions {
  store: AnalyticsStore;
  probes?: StatusProbe[];
  bot?: BotStatusCollector;
  collectors?: MetricCollector[];
  collectorTimeoutMs?: number;
  intervalMs?: number;
  dimensions?: Record<string, string>;
  onSnapshot?: (snapshot: StatusSnapshot) => void | Promise<void>;
}

export class StatusMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private previousCpu = process.cpuUsage();
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });

  constructor(private readonly options: StatusMonitorOptions) {}

  start(): void {
    if (this.timer) return;
    this.loopDelay.enable();
    const intervalMs = Math.max(1_000, this.options.intervalMs ?? 30_000);
    this.timer = setInterval(() => void this.sample(), intervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
    void this.sample();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.loopDelay.disable();
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async sample(): Promise<StatusSnapshot> {
    if (this.running) {
      return {
        id: crypto.randomUUID(),
        status: "unknown",
        checkedAt: new Date().toISOString(),
        components: [],
        metadata: { skipped: "sample-already-running" },
      };
    }
    this.running = true;
    try {
      const checkedAt = new Date().toISOString();
      const components: StatusComponent[] = [];
      for (const probe of this.options.probes ?? []) components.push(await runProbe(probe, checkedAt));
      const server = this.collectServer(checkedAt);
      const bot = this.options.bot ? { ...(await this.options.bot.collect()), checkedAt } : undefined;
      const points = [...serverPoints(server, this.options.dimensions), ...(bot ? botPoints(bot, this.options.dimensions) : [])];
      for (const collector of this.options.collectors ?? []) {
        try {
          const collected = await collectWithTimeout(collector, checkedAt, this.options.collectorTimeoutMs ?? 5_000);
          points.push(...collected.map((point) => ({ ...point, timestamp: point.timestamp || checkedAt, dimensions: { ...(this.options.dimensions ?? {}), ...(point.dimensions ?? {}), collector: collector.id } })));
        } catch (error) {
          components.push({
            id: `collector:${collector.id}`,
            label: collector.id,
            status: "degraded",
            checkedAt,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      for (const component of components) {
        points.push({
          name: "status.component",
          value: statusNumber(component.status),
          kind: "gauge",
          timestamp: checkedAt,
          dimensions: { ...(this.options.dimensions ?? {}), component: component.id },
        });
        if (component.latencyMs !== undefined) {
          points.push({
            name: "status.component.latency_ms",
            value: component.latencyMs,
            kind: "histogram",
            timestamp: checkedAt,
            dimensions: { ...(this.options.dimensions ?? {}), component: component.id },
          });
        }
      }
      await this.options.store.writeMany(points);
      const status = combineStatus(components, bot);
      const snapshot: StatusSnapshot = {
        id: crypto.randomUUID(),
        status,
        checkedAt,
        components,
        metadata: { server, ...(bot ? { bot } : {}) },
      };
      await this.options.onSnapshot?.(snapshot);
      return snapshot;
    } finally {
      this.running = false;
    }
  }

  private collectServer(checkedAt: string): ServerSnapshot {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(this.previousCpu);
    this.previousCpu = process.cpuUsage();
    const delayMs = Number.isFinite(this.loopDelay.mean) ? this.loopDelay.mean / 1_000_000 : 0;
    this.loopDelay.reset();
    return {
      processUptimeMs: Math.round(process.uptime() * 1_000),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      eventLoopDelayMs: delayMs,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      loadAverage: loadavg(),
      checkedAt,
    };
  }
}

export function createDiscordJsBotCollector(client: {
  isReady?(): boolean;
  ws?: { ping?: number };
  guilds?: { cache?: { size?: number; values?(): Iterable<{ memberCount?: number }> } };
  shard?: { count?: number };
  application?: { commands?: { cache?: { size?: number } } };
  uptime?: number | null;
  user?: { id?: string } | null;
}): BotStatusCollector {
  return {
    collect() {
      let userReach = 0;
      const values = client.guilds?.cache?.values?.();
      if (values) for (const guild of values) userReach += guild.memberCount ?? 0;
      return {
        botId: client.user?.id,
        ready: client.isReady?.() ?? Boolean(client.user),
        websocketPingMs: client.ws?.ping,
        guildCount: client.guilds?.cache?.size,
        userReach,
        shardCount: client.shard?.count,
        commandCount: client.application?.commands?.cache?.size,
        uptimeMs: client.uptime ?? undefined,
      };
    },
  };
}

async function runProbe(probe: StatusProbe, checkedAt: string): Promise<StatusComponent> {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(new Error("probe-timeout")), probe.timeoutMs ?? 5_000);
  try {
    const result = await probe.check(controller.signal);
    return { id: probe.id, label: probe.label, checkedAt, latencyMs: result.latencyMs ?? performance.now() - started, ...result };
  } catch (error) {
    return {
      id: probe.id,
      label: probe.label,
      status: "outage",
      checkedAt,
      latencyMs: performance.now() - started,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function serverPoints(snapshot: ServerSnapshot, dimensions?: Record<string, string>): MetricPoint[] {
  const values: Array<[string, number, MetricPoint["kind"]]> = [
    ["server.process.uptime_ms", snapshot.processUptimeMs, "gauge"],
    ["server.memory.rss_bytes", snapshot.rssBytes, "gauge"],
    ["server.memory.heap_used_bytes", snapshot.heapUsedBytes, "gauge"],
    ["server.memory.heap_total_bytes", snapshot.heapTotalBytes, "gauge"],
    ["server.memory.external_bytes", snapshot.externalBytes, "gauge"],
    ["server.event_loop.delay_ms", snapshot.eventLoopDelayMs, "histogram"],
    ["server.cpu.user_micros", snapshot.cpuUserMicros, "counter"],
    ["server.cpu.system_micros", snapshot.cpuSystemMicros, "counter"],
  ];
  return values.map(([name, value, kind]) => ({ name, value, kind, timestamp: snapshot.checkedAt, dimensions }));
}

function botPoints(snapshot: BotSnapshot, dimensions?: Record<string, string>): MetricPoint[] {
  const values: Array<[string, number | undefined, MetricPoint["kind"]]> = [
    ["bot.ready", snapshot.ready ? 1 : 0, "gauge"],
    ["bot.websocket.ping_ms", snapshot.websocketPingMs, "histogram"],
    ["bot.guilds", snapshot.guildCount, "gauge"],
    ["bot.user_reach", snapshot.userReach, "gauge"],
    ["bot.shards", snapshot.shardCount, "gauge"],
    ["bot.commands", snapshot.commandCount, "gauge"],
    ["bot.uptime_ms", snapshot.uptimeMs, "gauge"],
  ];
  return values
    .filter((entry): entry is [string, number, MetricPoint["kind"]] => entry[1] !== undefined)
    .map(([name, value, kind]) => ({ name, value, kind, timestamp: snapshot.checkedAt, dimensions: { ...(dimensions ?? {}), ...(snapshot.botId ? { botId: snapshot.botId } : {}) } }));
}

function combineStatus(components: StatusComponent[], bot?: BotSnapshot): StatusComponent["status"] {
  if (bot && !bot.ready) return "outage";
  if (components.some((component) => component.status === "outage")) return "outage";
  if (components.some((component) => component.status === "degraded")) return "degraded";
  if (!components.length && !bot) return "unknown";
  return "operational";
}

function statusNumber(status: StatusComponent["status"]): number {
  return status === "operational" ? 1 : status === "degraded" ? 0.5 : status === "outage" ? 0 : -1;
}

async function collectWithTimeout(collector: MetricCollector, checkedAt: string, timeoutMs: number): Promise<MetricPoint[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Metric collector timed out: ${collector.id}`);
      controller.abort(error);
      reject(error);
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([Promise.resolve(collector.collect(checkedAt, controller.signal)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
