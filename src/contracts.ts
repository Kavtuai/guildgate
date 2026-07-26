import { randomUUID } from "node:crypto";
import type { GuildGateStores } from "./stores.js";
import type { SessionRecord } from "./types.js";

export const adapterContractVersion = "1.1" as const;
export const actionContractVersion = "1.0" as const;
export const realtimeContractVersion = "1.0" as const;

export interface ContractCheck {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface ContractReport {
  contractVersion: string;
  checks: ContractCheck[];
  passed: boolean;
}

export async function runStoreContract(factory: () => GuildGateStores | Promise<GuildGateStores>): Promise<ContractReport> {
  const stores = await factory();
  const checks: ContractCheck[] = [];
  await check(checks, "sessions round-trip and user listing", async () => {
    const session = sampleSession();
    await stores.sessions.set(session);
    assertEqual((await stores.sessions.get(session.idHash))?.userId, session.userId);
    assertEqual((await stores.sessions.listByUser(session.userId)).length, 1);
    await stores.sessions.delete(session.idHash);
    assertEqual(await stores.sessions.get(session.idHash), null);
  });
  await check(checks, "OAuth state is consumed once", async () => {
    const now = Date.now();
    const record = { stateHash: randomUUID(), returnTo: "/", locale: "en" as const, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
    await stores.oauthStates.put(record);
    assertEqual((await stores.oauthStates.consume(record.stateHash, new Date(now).toISOString()))?.returnTo, "/");
    assertEqual(await stores.oauthStates.consume(record.stateHash, new Date(now).toISOString()), null);
  });
  await check(checks, "rate limit never exceeds configured limit", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => stores.rateLimits.hit({ key, limit: 5, windowMs: 60_000, nowMs: Date.now() })));
    assertEqual(results.filter((result) => result.allowed).length, 5);
  });
  await check(checks, "idempotency owns completion with a reservation token", async () => {
    const key = randomUUID();
    const firstReservation = randomUUID();
    const record = { key, requestHash: "a", reservationId: firstReservation, state: "inflight" as const, createdAtMs: Date.now(), expiresAtMs: Date.now() + 60_000 };
    assertEqual((await stores.idempotency.begin(record)).status, "started");
    assertEqual((await stores.idempotency.begin({ ...record, reservationId: randomUUID() })).status, "inflight");
    assertEqual((await stores.idempotency.begin({ ...record, requestHash: "b", reservationId: randomUUID() })).status, "conflict");
    if (stores.idempotency.renew) {
      assertEqual(await stores.idempotency.renew(key, Date.now() + 90_000, randomUUID()), false);
      assertEqual(await stores.idempotency.renew(key, Date.now() + 90_000, firstReservation), true);
    }
    assertEqual(await stores.idempotency.complete(key, { stale: true }, Date.now() + 60_000, randomUUID()), false);
    assertEqual(await stores.idempotency.fail(key, randomUUID()), false);
    assertEqual(await stores.idempotency.complete(key, { ok: true }, Date.now() + 60_000, firstReservation), true);
    assertEqual((await stores.idempotency.begin({ ...record, reservationId: randomUUID() })).status, "completed");
  });
  await check(checks, "distributed lock has mutual exclusion", async () => {
    const key = randomUUID();
    assertEqual(await stores.locks.acquire(key, "one", 2_000, 0), true);
    assertEqual(await stores.locks.acquire(key, "two", 2_000, 0), false);
    await stores.locks.release(key, "one");
    assertEqual(await stores.locks.acquire(key, "two", 2_000, 0), true);
    await stores.locks.release(key, "two");
  });
  if (stores.locks.acquireLease && stores.locks.renew) {
    await check(checks, "lease locks renew and issue increasing fencing tokens", async () => {
      const key = randomUUID();
      const first = await stores.locks.acquireLease!(key, "lease-one", 2_000, 0);
      if (!first) throw new Error("First lease was not acquired");
      assertEqual(await stores.locks.renew!(key, "lease-one", 2_000), true);
      await stores.locks.release(key, "lease-one");
      const second = await stores.locks.acquireLease!(key, "lease-two", 2_000, 0);
      if (!second) throw new Error("Second lease was not acquired");
      if (second.fencingToken <= first.fencingToken) throw new Error("Fencing token did not increase");
      await stores.locks.release(key, "lease-two");
    });
  }
  await check(checks, "cache invalidates by tag", async () => {
    await stores.cache.set("contract:cache", { value: 1, expiresAtMs: Date.now() + 60_000, tags: ["contract"] });
    assertEqual((await stores.cache.get<number>("contract:cache"))?.value, 1);
    assertEqual(await stores.cache.deleteByTags(["contract"]), 1);
    assertEqual(await stores.cache.get("contract:cache"), null);
  });
  await check(checks, "cache retagging does not keep destructive stale membership", async () => {
    const cacheKey = `contract:retag:${randomUUID()}`;
    await stores.cache.set(cacheKey, { value: 1, expiresAtMs: Date.now() + 60_000, tags: ["old-tag"] });
    await stores.cache.set(cacheKey, { value: 2, expiresAtMs: Date.now() + 60_000, tags: ["new-tag"] });
    assertEqual(await stores.cache.deleteByTags(["old-tag"]), 0);
    assertEqual((await stores.cache.get<number>(cacheKey))?.value, 2);
    assertEqual(await stores.cache.deleteByTags(["new-tag"]), 1);
  });
  const listAuditPage = stores.audit.listPage;
  if (listAuditPage) {
    await check(checks, "audit cursor reaches later pages without duplicates", async () => {
      const action = `contract.audit.${randomUUID()}`;
      const createdAt = new Date().toISOString();
      for (let index = 0; index < 5; index += 1) {
        await stores.audit.write({
          id: `${index}`.padStart(2, "0"), requestId: randomUUID(), action,
          actor: { type: "system" }, result: "success", policyVersion: 1,
          metadata: { durationMs: index }, createdAt,
        });
      }
      const first = await listAuditPage({ action, limit: 2 });
      const second = await listAuditPage({ action, limit: 2, cursor: first.nextCursor });
      const third = await listAuditPage({ action, limit: 2, cursor: second.nextCursor });
      const ids = [...first.items, ...second.items, ...third.items].map((event) => event.id);
      assertEqual(new Set(ids).size, 5);
      assertEqual(ids.length, 5);
    });
  }
  if (stores.outbox.claim) {
    await check(checks, "outbox claims isolate workers", async () => {
      const now = new Date().toISOString();
      const record = {
        id: randomUUID(),
        createdAt: now,
        attempts: 0,
        event: { version: 1 as const, id: randomUUID(), event: "contract.event", channel: "contract", timestamp: now, data: { ok: true } },
      };
      await stores.outbox.enqueue(record);
      const first = await stores.outbox.claim!(1, "worker-one", 30_000);
      assertEqual(first.length, 1);
      const second = await stores.outbox.claim!(1, "worker-two", 30_000);
      assertEqual(second.length, 0);
      await stores.outbox.markPublished(record.id, new Date().toISOString());
    });
  }
  return { contractVersion: adapterContractVersion, checks, passed: checks.every((item) => item.passed) };
}

export async function runLoadScenario(input: {
  concurrency: number;
  operations: number;
  execute(index: number): Promise<void>;
}): Promise<{ operations: number; failures: number; durationMs: number; throughputPerSecond: number; p50Ms: number; p95Ms: number; p99Ms: number }> {
  const started = performance.now();
  const latencies: number[] = [];
  let next = 0;
  let failures = 0;
  const workers = Array.from({ length: Math.max(1, input.concurrency) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= input.operations) return;
      const operationStart = performance.now();
      try { await input.execute(index); } catch { failures += 1; }
      latencies.push(performance.now() - operationStart);
    }
  });
  await Promise.all(workers);
  const durationMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  return {
    operations: input.operations,
    failures,
    durationMs,
    throughputPerSecond: durationMs > 0 ? (input.operations / durationMs) * 1_000 : input.operations,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
  };
}

async function check(checks: ContractCheck[], name: string, execute: () => Promise<void>): Promise<void> {
  const started = performance.now();
  try {
    await execute();
    checks.push({ name, passed: true, durationMs: performance.now() - started });
  } catch (error) {
    checks.push({ name, passed: false, durationMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) });
  }
}

function sampleSession(): SessionRecord {
  const now = new Date();
  return {
    idHash: randomUUID(),
    userId: randomUUID(),
    locale: "en",
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    idleExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    rotateAfter: new Date(now.getTime() + 30_000).toISOString(),
  };
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(value * values.length) - 1))] ?? 0;
}
