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
  const limit = Math.max(1, input.limit ?? 100);
  const workerId = input.workerId ?? randomUUID();
  const records = input.store.claim
    ? await input.store.claim(limit, workerId, input.claimLeaseMs ?? 30_000)
    : await input.store.next(limit);
  let published = 0;
  let failed = 0;
  const queue = [...records];
  const workers = Array.from({ length: Math.min(queue.length || 1, Math.max(1, input.concurrency ?? 4)) }, async () => {
    for (;;) {
      const record = queue.shift();
      if (!record) return;
      try {
        await input.publisher.publish(record.event);
        await input.store.markPublished(record.id, (input.now ?? (() => new Date()))().toISOString());
        published += 1;
      } catch (error) {
        await input.store.markFailed(record.id, error instanceof Error ? error.message : String(error));
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
