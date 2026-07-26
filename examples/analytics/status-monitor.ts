import {
  MemoryAnalyticsStore,
  StatusMonitor,
  bucketMetrics,
  buildAnalyticsTable,
  createDiscordJsBotCollector,
  renderLineChartSvg,
} from "@kavtuai/guildgate/analytics";

export async function createStatusDashboard(discordClient: unknown) {
  const store = new MemoryAnalyticsStore();
  const monitor = new StatusMonitor({
    store,
    intervalMs: 30_000,
    bot: createDiscordJsBotCollector(discordClient as never),
    probes: [{
      id: "api",
      label: "Dashboard API",
      async check() {
        return { status: "operational" as const };
      },
    }],
  });

  monitor.start();
  const points = await store.query({ names: ["bot.websocket.ping_ms"] });
  const buckets = bucketMetrics(points, 5 * 60_000);

  return {
    svg: renderLineChartSvg({
      title: "Gateway latency",
      labels: buckets.map((bucket) => bucket.start),
      series: [{ name: "p95", values: buckets.map((bucket) => bucket.p95) }],
    }),
    table: buildAnalyticsTable({
      columns: [
        { key: "start", label: "Start" },
        { key: "p95", label: "p95" },
      ],
      rows: buckets,
    }),
    stop: () => monitor.stop(),
  };
}
