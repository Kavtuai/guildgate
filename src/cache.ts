import type { CacheStore, LockStore } from "./stores.js";
import { randomToken } from "./crypto.js";

export class CacheManager {
  constructor(
    private readonly store: CacheStore,
    private readonly locks: LockStore,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = await this.store.get<T>(key);
    if (!entry || entry.expiresAtMs <= Date.now()) return null;
    return entry.value;
  }

  async set<T>(key: string, value: T, input: { ttlMs: number; staleMs?: number; tags?: string[] }): Promise<void> {
    const now = Date.now();
    await this.store.set(key, {
      value,
      expiresAtMs: now + input.ttlMs,
      staleUntilMs: input.staleMs ? now + input.ttlMs + input.staleMs : undefined,
      tags: input.tags ?? [],
    });
  }

  async remember<T>(input: {
    key: string;
    ttlMs: number;
    staleMs?: number;
    tags?: string[];
    lockTtlMs?: number;
    waitMs?: number;
    load: () => Promise<T>;
  }): Promise<T> {
    const entry = await this.store.get<T>(input.key);
    const now = Date.now();
    if (entry && entry.expiresAtMs > now) return entry.value;

    const token = randomToken(16);
    const lockKey = `cache-load:${input.key}`;
    const acquired = await this.locks.acquire(lockKey, token, input.lockTtlMs ?? 5_000, input.waitMs ?? 1_000);
    if (!acquired) {
      if (entry && (entry.staleUntilMs ?? 0) > now) return entry.value;
      return input.load();
    }

    try {
      const secondRead = await this.store.get<T>(input.key);
      if (secondRead && secondRead.expiresAtMs > Date.now()) return secondRead.value;
      const value = await input.load();
      await this.set(input.key, value, input);
      return value;
    } finally {
      await this.locks.release(lockKey, token);
    }
  }

  invalidateTags(tags: string[]): Promise<number> {
    return this.store.deleteByTags(tags);
  }
}
