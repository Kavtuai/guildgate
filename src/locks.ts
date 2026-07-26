import { randomToken } from "./crypto.js";
import { errors } from "./errors.js";
import type { LockStore } from "./stores.js";

export interface LockLease {
  key: string;
  token: string;
  fencingToken: number;
  expiresAtMs: number;
}

export interface LeaseLockStore extends LockStore {
  acquireLease(key: string, token: string, ttlMs: number, waitMs: number): Promise<LockLease | null>;
  renew(key: string, token: string, ttlMs: number): Promise<boolean>;
}

export interface HeldLock {
  readonly lease: LockLease;
  readonly signal: AbortSignal;
  assertOwned(): void;
  release(): Promise<void>;
}

export class DistributedLockManager {
  constructor(private readonly store: LockStore) {}

  async acquire(input: {
    key: string;
    ttlMs: number;
    waitMs?: number;
    renewEveryMs?: number;
  }): Promise<HeldLock> {
    if (!input.key || input.key.length > 512) throw errors.configuration("Lock keys must contain 1-512 characters");
    if (!Number.isFinite(input.ttlMs) || input.ttlMs < 100) throw errors.configuration("Lock ttlMs must be at least 100ms");
    if ((input.waitMs ?? 0) < 0) throw errors.configuration("Lock waitMs cannot be negative");
    const token = randomToken(18);
    const store = this.store;
    const leaseStore = isLeaseLockStore(this.store) ? this.store : undefined;
    let lease: LockLease;

    if (leaseStore) {
      const acquired = await leaseStore.acquireLease(input.key, token, input.ttlMs, input.waitMs ?? 0);
      if (!acquired) throw errors.lockUnavailable();
      lease = acquired;
    } else {
      const acquired = await this.store.acquire(input.key, token, input.ttlMs, input.waitMs ?? 0);
      if (!acquired) throw errors.lockUnavailable();
      lease = { key: input.key, token, fencingToken: 0, expiresAtMs: Date.now() + input.ttlMs };
    }

    const controller = new AbortController();
    let owned = true;
    const renewEveryMs = leaseStore ? Math.max(100, input.renewEveryMs ?? Math.floor(input.ttlMs / 3)) : 0;
    let renewing = false;
    const timer = renewEveryMs > 0
      ? setInterval(async () => {
          if (renewing || !owned) return;
          renewing = true;
          try {
            const renewed = await leaseStore!.renew(input.key, token, input.ttlMs);
            if (!renewed) {
              owned = false;
              controller.abort(errors.lockLost({ key: input.key, fencingToken: lease.fencingToken }));
            } else {
              lease.expiresAtMs = Date.now() + input.ttlMs;
            }
          } catch (error) {
            owned = false;
            controller.abort(error);
          } finally {
            renewing = false;
          }
        }, renewEveryMs)
      : undefined;
    (timer as unknown as { unref?: () => void } | undefined)?.unref?.();

    return {
      lease,
      signal: controller.signal,
      assertOwned() {
        if (!owned || controller.signal.aborted) throw errors.lockLost({ key: input.key, fencingToken: lease.fencingToken });
      },
      async release() {
        if (timer) clearInterval(timer);
        owned = false;
        await store.release(input.key, token);
      },
    };
  }
}

export function isLeaseLockStore(store: LockStore): store is LeaseLockStore {
  return typeof (store as Partial<LeaseLockStore>).acquireLease === "function"
    && typeof (store as Partial<LeaseLockStore>).renew === "function";
}
