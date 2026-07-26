import test from "node:test";
import assert from "node:assert/strict";
import { runLoadScenario, runStoreContract } from "../dist/contracts.js";
import { createMemoryStoreBundle } from "../dist/memory-store.js";

test("official memory adapter passes the stable store contract", async () => {
  const report = await runStoreContract(createMemoryStoreBundle);
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
});

test("load harness reports throughput and latency", async () => {
  const report = await runLoadScenario({ concurrency: 8, operations: 200, execute: async () => { await Promise.resolve(); } });
  assert.equal(report.failures, 0);
  assert.equal(report.operations, 200);
  assert.equal(report.throughputPerSecond > 0, true);
});
