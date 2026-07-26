import { randomUUID } from "node:crypto";
import { errors } from "./errors.js";

export type TransactionIsolation = "read-committed" | "repeatable-read" | "serializable";

export interface TransactionOptions {
  isolation?: TransactionIsolation;
  readOnly?: boolean;
  timeoutMs?: number;
  name?: string;
}

export interface TransactionScope {
  readonly id: string;
  readonly backend?: string;
  readonly raw?: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
  afterCommit(callback: () => void | Promise<void>): void;
  afterRollback(callback: (error: unknown) => void | Promise<void>): void;
}

export interface TransactionAdapter {
  run<T>(options: TransactionOptions, work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

export interface TransactionHooks<I, O> {
  before?: (scope: TransactionScope, input: I) => void | Promise<void>;
  beforeCommit?: (scope: TransactionScope, result: O, input: I) => void | Promise<void>;
  afterCommit?: (result: O, input: I) => void | Promise<void>;
  afterRollback?: (error: unknown, input: I) => void | Promise<void>;
}

export interface OptimisticRevisionPolicy<I> {
  expected: (input: I) => number | string;
  current: (input: I) => number | string | Promise<number | string>;
  resource?: (input: I) => string;
}

export async function assertOptimisticRevision<I>(policy: OptimisticRevisionPolicy<I>, input: I): Promise<void> {
  const expected = policy.expected(input);
  const current = await policy.current(input);
  if (String(expected) !== String(current)) {
    throw errors.revisionConflict({
      expected,
      current,
      resource: policy.resource?.(input),
    });
  }
}

export function createMemoryTransactionAdapter(): TransactionAdapter {
  return {
    async run<T>(options: TransactionOptions, work: (scope: TransactionScope) => Promise<T>): Promise<T> {
      const afterCommit: Array<() => void | Promise<void>> = [];
      const afterRollback: Array<(error: unknown) => void | Promise<void>> = [];
      const scope: TransactionScope = {
        id: randomUUID(),
        backend: "memory",
        metadata: Object.freeze({ isolation: options.isolation ?? "read-committed", readOnly: options.readOnly ?? false }),
        afterCommit(callback) {
          afterCommit.push(callback);
        },
        afterRollback(callback) {
          afterRollback.push(callback);
        },
      };

      try {
        const result = await work(scope);
        for (const callback of afterCommit) await callback();
        return result;
      } catch (error) {
        for (const callback of afterRollback) await callback(error);
        throw error;
      }
    },
  };
}
