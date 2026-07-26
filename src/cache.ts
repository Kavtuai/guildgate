import type { CacheStore, LockStore } from "./stores.js";
import { DistributedLockManager } from "./locks.js";

export class CacheManager {
  private readonly lockManager: DistributedLockManager;

  constructor(
    private readonly store: CacheStore,
    locks: LockStore,
  ) {
    this.lockManager = new DistributedLockManager(locks);
  }

  async get<T>(key: string): Promise<T | null> {
    assertCacheKey(key);
    const entry = await this.store.get<T>(key);
    if (!entry || entry.expiresAtMs <= Date.now()) return null;
    return entry.value;
  }

  async set<T>(key: string, value: T, input: { ttlMs: number; staleMs?: number; tags?: string[] }): Promise<void> {
    assertCacheKey(key);
    assertCacheTiming(input.ttlMs, input.staleMs);
    const tags = normalizeTags(input.tags ?? []);
    const now = Date.now();
    await this.store.set(key, {
      value,
      expiresAtMs: now + input.ttlMs,
      staleUntilMs: input.staleMs ? now + input.ttlMs + input.staleMs : undefined,
      tags,
    });
  }

  async remember<T>(input: {
    key: string;
    ttlMs: number;
    staleMs?: number;
    tags?: string[];
    lockTtlMs?: number;
    waitMs?: number;
    load: (signal?: AbortSignal) => Promise<T>;
  }): Promise<T> {
    assertCacheKey(input.key);
    assertCacheTiming(input.ttlMs, input.staleMs);
    if (input.lockTtlMs !== undefined && (!Number.isFinite(input.lockTtlMs) || input.lockTtlMs < 100)) {
      throw new TypeError("Cache lockTtlMs must be at least 100ms");
    }
    if (input.waitMs !== undefined && (!Number.isFinite(input.waitMs) || input.waitMs < 0)) {
      throw new TypeError("Cache waitMs cannot be negative");
    }

    const entry = await this.store.get<T>(input.key);
    const now = Date.now();
    if (entry && entry.expiresAtMs > now) return entry.value;

    let held;
    try {
      held = await this.lockManager.acquire({
        key: `cache-load:${input.key}`,
        ttlMs: input.lockTtlMs ?? 5_000,
        waitMs: input.waitMs ?? 1_000,
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code !== "RESOURCE_BUSY") throw error;
      if (entry && (entry.staleUntilMs ?? 0) > now) return entry.value;
      const value = await input.load();
      await this.set(input.key, value, input);
      return value;
    }

    try {
      const secondRead = await this.store.get<T>(input.key);
      if (secondRead && secondRead.expiresAtMs > Date.now()) return secondRead.value;
      const value = await input.load(held.signal);
      held.assertOwned();
      await this.set(input.key, value, input);
      return value;
    } finally {
      await held.release();
    }
  }

  invalidateTags(tags: string[]): Promise<number> {
    return this.store.deleteByTags(normalizeTags(tags));
  }
}

function assertCacheKey(key: string): void {
  if (!key || key.length > 1_024 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new TypeError("Cache keys must contain 1-1024 printable characters");
  }
}

function assertCacheTiming(ttlMs: number, staleMs?: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new TypeError("Cache ttlMs must be positive");
  if (staleMs !== undefined && (!Number.isFinite(staleMs) || staleMs < 0)) {
    throw new TypeError("Cache staleMs cannot be negative");
  }
}

function normalizeTags(tags: string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()))];
  if (normalized.length > 128) throw new TypeError("Cache entries cannot contain more than 128 tags");
  for (const tag of normalized) {
    if (!tag || tag.length > 256 || /[\u0000-\u001f\u007f]/.test(tag)) {
      throw new TypeError("Cache tags must contain 1-256 printable characters");
    }
  }
  return normalized;
}
