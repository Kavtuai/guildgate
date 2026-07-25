import type { RealtimePublisher } from "../kernel.js";
import type { OutboxStore } from "../stores.js";

export async function dispatchOutbox(input: {
  store: OutboxStore;
  publisher: RealtimePublisher;
  limit?: number;
  now?: () => Date;
}): Promise<{ published: number; failed: number }> {
  const records = await input.store.next(input.limit ?? 100);
  let published = 0;
  let failed = 0;
  for (const record of records) {
    try {
      await input.publisher.publish(record.event);
      await input.store.markPublished(record.id, (input.now ?? (() => new Date()))().toISOString());
      published += 1;
    } catch (error) {
      await input.store.markFailed(record.id, error instanceof Error ? error.message : String(error));
      failed += 1;
    }
  }
  return { published, failed };
}
