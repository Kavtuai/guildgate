import { randomUUID } from "node:crypto";
import { errors } from "./errors.js";

export type TransactionIsolation = "read-committed" | "repeatable-read" | "serializable";

export interface TransactionOptions {
  isolation?: TransactionIsolation;
  readOnly?: boolean;
  timeoutMs?: number;
  name?: string;
  onPostCommitError?: (error: unknown, callbackIndex: number) => void | Promise<void>;
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

export class TransactionPostCommitError<T = unknown> extends Error {
  readonly committed = true;
  readonly result: T;
  readonly callbackErrors: readonly unknown[];

  constructor(result: T, callbackErrors: readonly unknown[]) {
    super("The transaction committed, but one or more afterCommit callbacks failed", {
      cause: callbackErrors[0],
    });
    this.name = "TransactionPostCommitError";
    this.result = result;
    this.callbackErrors = [...callbackErrors];
  }
}

export function isTransactionPostCommitError(error: unknown): error is TransactionPostCommitError {
  return error instanceof TransactionPostCommitError;
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
        metadata: Object.freeze({
          isolation: options.isolation ?? "read-committed",
          readOnly: options.readOnly ?? false,
          name: options.name ?? "transaction",
        }),
        afterCommit(callback) {
          afterCommit.push(callback);
        },
        afterRollback(callback) {
          afterRollback.push(callback);
        },
      };

      let result: T;
      try {
        result = await work(scope);
      } catch (error) {
        await runRollbackCallbacks(afterRollback, error);
        throw error;
      }

      await runPostCommitCallbacks(afterCommit, options, result);
      return result;
    },
  };
}

export async function runPostCommitCallbacks<T>(
  callbacks: ReadonlyArray<() => void | Promise<void>>,
  options: TransactionOptions,
  result: T,
): Promise<void> {
  const failures: unknown[] = [];

  for (let index = 0; index < callbacks.length; index += 1) {
    const callback = callbacks[index];
    if (!callback) continue;
    try {
      await callback();
    } catch (error) {
      failures.push(error);
      if (options.onPostCommitError) {
        try {
          await options.onPostCommitError(error, index);
        } catch (reportError) {
          failures.push(reportError);
        }
      }
    }
  }

  if (failures.length && !options.onPostCommitError) {
    throw new TransactionPostCommitError(result, failures);
  }
}

export async function runRollbackCallbacks(
  callbacks: ReadonlyArray<(error: unknown) => void | Promise<void>>,
  error: unknown,
): Promise<void> {
  await Promise.allSettled(callbacks.map((callback) => callback(error)));
}
