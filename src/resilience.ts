import { errors, GuildGateError } from "./errors.js";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maximumDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  delayMs?: (error: unknown, attempt: number) => number | undefined;
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
    const remaining = input.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw errors.timeout();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(errors.timeout()), remaining);
    const onParentAbort = () => controller.abort(input.parentSignal?.reason);
    input.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      return await input.execute(controller.signal, attempt);
    } catch (error) {
      lastError = error;
      if (controller.signal.aborted && !input.parentSignal?.aborted) throw errors.timeout();
      const retryable = input.retry?.shouldRetry?.(error, attempt) ?? defaultShouldRetry(error);
      if (!retryable || attempt >= attempts) throw error;
      const remainingAfterFailure = input.timeoutMs - (Date.now() - startedAt);
      if (remainingAfterFailure <= 0) throw errors.timeout();
      const configuredDelay = input.retry?.delayMs?.(error, attempt);
      const delay = configuredDelay === undefined
        ? jitteredDelay(input.retry!, attempt)
        : Math.max(0, configuredDelay);
      await sleep(Math.min(delay, remainingAfterFailure), input.parentSignal);
    } finally {
      clearTimeout(timer);
      input.parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastError;
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof GuildGateError) return error.retryable;
  return error instanceof TypeError;
}

function jitteredDelay(options: RetryOptions, attempt: number): number {
  const exponential = Math.min(options.maximumDelayMs, options.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exponential * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

interface CircuitState {
  failures: number;
  openUntilMs: number;
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(private readonly input: { failureThreshold: number; resetAfterMs: number }) {}

  async run<T>(name: string, execute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const state = this.states.get(name) ?? { failures: 0, openUntilMs: 0 };
    if (state.openUntilMs > now) throw errors.upstreamUnavailable({ circuit: name, openUntilMs: state.openUntilMs });
    try {
      const result = await execute();
      this.states.delete(name);
      return result;
    } catch (error) {
      state.failures += 1;
      if (state.failures >= this.input.failureThreshold) state.openUntilMs = now + this.input.resetAfterMs;
      this.states.set(name, state);
      throw error;
    }
  }
}
