import { cpus } from "node:os";
import { writeFile } from "node:fs/promises";
import { createGuildGateTestHarness } from "../dist/testing.js";
import { runLoadScenario } from "../dist/contracts.js";

const operations = numberArg("--operations", 5_000);
const concurrency = numberArg("--concurrency", Math.min(32, Math.max(4, cpus().length * 2)));
const harness = createGuildGateTestHarness();
const login = await harness.login("load-user");
let executions = 0;

const action = harness.kernel.action({
  name: "load.settings.update",
  parse: (value) => value,
  rateLimit: { limit: operations + 100, windowMs: 60_000 },
  idempotency: { ttlMs: 60_000 },
  concurrency: { key: (_context, input) => `guild:${input.guildId}`, ttlMs: 5_000, waitMs: 2_000 },
  timeoutMs: 5_000,
  async execute(_context, input) {
    executions += 1;
    return { guildId: input.guildId, saved: true };
  },
});

const report = await runLoadScenario({
  operations,
  concurrency,
  execute: async (index) => {
    const result = await harness.kernel.execute(action, harness.request({
      body: { guildId: String(index % Math.max(1, concurrency)) },
      sessionToken: login.sessionToken,
      csrfToken: login.csrfToken,
      idempotencyKey: `load-${index}`,
    }));
    if (!result.ok) throw new Error(result.error.code);
  },
});

const output = {
  package: "@kavtuai/guildgate",
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpuCount: cpus().length },
  scenario: "in-memory guarded writes with unique idempotency keys and shared resource locks",
  concurrency,
  operations,
  domainExecutions: executions,
  ...report,
  limitations: [
    "No network, Redis, PostgreSQL or Discord request is included.",
    "Numbers are useful for regression comparison on the same class of machine.",
    "This report is not a production capacity promise.",
  ],
};

await writeFile(new URL("../LOAD_TEST_REPORT.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
process.exitCode = report.failures === 0 && executions === operations ? 0 : 1;

function numberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
