import { errors, GuildGateError } from "./errors.js";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maximumDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  delayMs?: (error: unknown, attempt: number) => number | undefined;
}

export type DeadlineSettlement<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export class DeadlineExceededError<T = unknown> extends GuildGateError {
  readonly settlement: Promise<DeadlineSettlement<T>>;

  constructor(settlement: Promise<DeadlineSettlement<T>>) {
    super({ code: "UPSTREAM_TIMEOUT", status: 504, retryable: true });
    this.name = "DeadlineExceededError";
    this.settlement = settlement;
  }
}

export function isDeadlineExceededError<T = unknown>(error: unknown): error is DeadlineExceededError<T> {
  return error instanceof DeadlineExceededError;
}

export class OperationAbortedError<T = unknown> extends GuildGateError {
  readonly settlement: Promise<DeadlineSettlement<T>>;

  constructor(settlement: Promise<DeadlineSettlement<T>>, cause?: unknown) {
    super({ code: "REQUEST_ABORTED", status: 499, retryable: true, cause });
    this.name = "OperationAbortedError";
    this.settlement = settlement;
  }
}

export function isOperationAbortedError<T = unknown>(error: unknown): error is OperationAbortedError<T> {
  return error instanceof OperationAbortedError;
}

export async function runWithDeadline<T>(input: {
  timeoutMs: number;
  parentSignal?: AbortSignal;
  retry?: RetryOptions;
  execute: (signal: AbortSignal, attempt: number) => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  const attempts = Math.max(1, input.retry?.attempts ?? 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (input.parentSignal?.aborted) throw errors.requestAborted();
    const remaining = input.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new DeadlineExceededError(Promise.resolve({ status: "rejected", reason: errors.timeout() }));

    const controller = new AbortController();
    const timeoutError = errors.timeout();
    const operation = Promise.resolve().then(() => input.execute(controller.signal, attempt));
    const settlement: Promise<DeadlineSettlement<T>> = operation.then(
      (value) => ({ status: "fulfilled", value }),
      (reason: unknown) => ({ status: "rejected", reason }),
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    let parentAbortHandler: (() => void) | undefined;
    const timeoutOutcome = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), remaining);
      // The awaited deadline race must keep this timer referenced on Node.js 22.
    });
    const parentOutcome = new Promise<{ kind: "parent"; reason: unknown }>((resolve) => {
      if (!input.parentSignal) return;
      parentAbortHandler = () => resolve({ kind: "parent", reason: input.parentSignal?.reason });
      input.parentSignal.addEventListener("abort", parentAbortHandler, { once: true });
    });

    const outcome = await Promise.race([
      settlement.then((result) => ({ kind: "settled" as const, result })),
      timeoutOutcome,
      parentOutcome,
    ]);

    if (timer) clearTimeout(timer);
    if (parentAbortHandler) input.parentSignal?.removeEventListener("abort", parentAbortHandler);

    if (outcome.kind === "timeout") {
      controller.abort(timeoutError);
      throw new DeadlineExceededError(settlement);
    }
    if (outcome.kind === "parent") {
      controller.abort(outcome.reason);
      throw new OperationAbortedError(settlement, outcome.reason);
    }
    if (outcome.result.status === "fulfilled") return outcome.result.value;

    lastError = outcome.result.reason;
    const retryable = input.retry?.shouldRetry?.(lastError, attempt) ?? defaultShouldRetry(lastError);
    if (!retryable || attempt >= attempts) throw lastError;
    const remainingAfterFailure = input.timeoutMs - (Date.now() - startedAt);
    if (remainingAfterFailure <= 0) throw new DeadlineExceededError(Promise.resolve({ status: "rejected", reason: lastError }));
    const configuredDelay = input.retry?.delayMs?.(lastError, attempt);
    const delay = configuredDelay === undefined
      ? jitteredDelay(input.retry!, attempt)
      : Math.max(0, configuredDelay);
    try {
      await sleep(Math.min(delay, remainingAfterFailure), input.parentSignal);
    } catch {
      if (input.parentSignal?.aborted) throw errors.requestAborted();
      throw lastError;
    }
  }

  throw lastError;
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof GuildGateError) return error.retryable;
  return false;
}

function jitteredDelay(options: RetryOptions, attempt: number): number {
  const exponential = Math.min(options.maximumDelayMs, options.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exponential * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type CircuitStatus = "closed" | "open" | "half-open";

interface CircuitState {
  failures: number;
  openUntilMs: number;
  halfOpenInFlight: boolean;
  lastFailureAtMs?: number;
}

export interface CircuitSnapshot {
  name: string;
  status: CircuitStatus;
  failures: number;
  openUntilMs: number;
  lastFailureAtMs?: number;
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(private readonly input: { failureThreshold: number; resetAfterMs: number }) {
    if (input.failureThreshold < 1 || input.resetAfterMs < 1) throw new TypeError("Invalid circuit breaker configuration");
  }

  async run<T>(name: string, execute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const state = this.states.get(name) ?? { failures: 0, openUntilMs: 0, halfOpenInFlight: false };
    if (state.openUntilMs > now) throw errors.upstreamUnavailable({ circuit: name, openUntilMs: state.openUntilMs });
    const halfOpen = state.failures >= this.input.failureThreshold && state.openUntilMs <= now;
    if (halfOpen && state.halfOpenInFlight) throw errors.upstreamUnavailable({ circuit: name, halfOpen: true });
    if (halfOpen) state.halfOpenInFlight = true;
    this.states.set(name, state);
    try {
      const result = await execute();
      this.states.delete(name);
      return result;
    } catch (error) {
      state.failures += 1;
      state.lastFailureAtMs = Date.now();
      state.halfOpenInFlight = false;
      if (state.failures >= this.input.failureThreshold) state.openUntilMs = Date.now() + this.input.resetAfterMs;
      this.states.set(name, state);
      throw error;
    }
  }

  inspect(name?: string): CircuitSnapshot[] {
    const now = Date.now();
    return [...this.states.entries()]
      .filter(([key]) => !name || key === name)
      .map(([key, state]) => ({
        name: key,
        status: state.openUntilMs > now ? "open" : state.failures >= this.input.failureThreshold ? "half-open" : "closed",
        failures: state.failures,
        openUntilMs: state.openUntilMs,
        lastFailureAtMs: state.lastFailureAtMs,
      }));
  }

  reset(name?: string): void {
    if (name) this.states.delete(name);
    else this.states.clear();
  }
}
