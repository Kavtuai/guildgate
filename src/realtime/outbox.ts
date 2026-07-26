import { randomUUID } from "node:crypto";
import type { RealtimePublisher } from "../kernel.js";
import type { OutboxStore } from "../stores.js";

export interface OutboxDispatchResult {
  published: number;
  failed: number;
  claimed: number;
}

export async function dispatchOutbox(input: {
  store: OutboxStore;
  publisher: RealtimePublisher;
  limit?: number;
  now?: () => Date;
  workerId?: string;
  claimLeaseMs?: number;
  concurrency?: number;
}): Promise<OutboxDispatchResult> {
  const limit = Math.min(5_000, Math.max(1, Math.floor(input.limit ?? 100)));
  const workerId = input.workerId ?? randomUUID();
  const claimLeaseMs = Math.min(24 * 60 * 60_000, Math.max(1_000, Math.floor(input.claimLeaseMs ?? 30_000)));
  const concurrency = Math.min(64, Math.max(1, Math.floor(input.concurrency ?? 4)));
  const records = input.store.claim
    ? await input.store.claim(limit, workerId, claimLeaseMs)
    : await input.store.next(limit);
  let published = 0;
  let failed = 0;
  const queue = [...records];
  const workers = Array.from({ length: Math.min(queue.length || 1, concurrency) }, async () => {
    for (;;) {
      const record = queue.shift();
      if (!record) return;
      try {
        await input.publisher.publish(record.event);
        await input.store.markPublished(record.id, (input.now ?? (() => new Date()))().toISOString());
        published += 1;
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 2_048);
        await input.store.markFailed(record.id, message);
        failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return { published, failed, claimed: records.length };
}

export function createOutboxWorker(input: {
  store: OutboxStore;
  publisher: RealtimePublisher;
  intervalMs?: number;
  batchSize?: number;
  workerId?: string;
  claimLeaseMs?: number;
  concurrency?: number;
  onError?: (error: unknown) => void;
}) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const workerId = input.workerId ?? randomUUID();
  const runOnce = async () => {
    if (running) return { published: 0, failed: 0, claimed: 0 };
    running = true;
    try {
      return await dispatchOutbox({
        store: input.store,
        publisher: input.publisher,
        limit: input.batchSize,
        workerId,
        claimLeaseMs: input.claimLeaseMs,
        concurrency: input.concurrency,
      });
    } catch (error) {
      input.onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  };
  return {
    workerId,
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => { void runOnce().catch(() => undefined); }, Math.max(250, input.intervalMs ?? 1_000));
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      while (running) await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}
