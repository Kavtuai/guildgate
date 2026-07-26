import test from "node:test";
import assert from "node:assert/strict";
import { buildPostgresMigration, createPostgresAdapter } from "../dist/postgres.js";

test("PostgreSQL migration includes durable queue and analytics structures", () => {
  const sql = buildPostgresMigration("gg");
  assert.match(sql, /gg_outbox/);
  assert.match(sql, /gg_metrics/);
  assert.match(sql, /gg_realtime_events/);
  assert.match(sql, /lock_fencing_seq/);
});

test("PostgreSQL transaction adapter commits and runs afterCommit hooks", async () => {
  const statements = [];
  const client = {
    async query(text) { statements.push(text); return { rows: [] }; },
    release() { statements.push("RELEASE"); },
  };
  const pool = {
    async query(text) { statements.push(text); return { rows: [] }; },
    async connect() { return client; },
  };
  const adapter = createPostgresAdapter({ pool, prefix: "gg" });
  let committed = false;
  const result = await adapter.transactions.run({ isolation: "serializable" }, async (scope) => {
    scope.afterCommit(() => { committed = true; });
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(committed, true);
  assert.deepEqual(statements.slice(0, 3), ["BEGIN", "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE", "COMMIT"]);
});
