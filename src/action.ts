import type { CacheManager } from "./cache.js";
import type { GuildGateStores } from "./stores.js";
import type {
  RealtimeEvent,
  RequestEnvelope,
  ResourceRef,
  SessionRecord,
  SupportedLocale,
} from "./types.js";

export interface AuthorizationDecision {
  allowed: boolean;
  code?: string;
  details?: Record<string, unknown>;
}

export interface ActionContext {
  requestId: string;
  request: RequestEnvelope;
  locale: SupportedLocale;
  session: SessionRecord | null;
  userId?: string;
  isOwner: boolean;
  signal: AbortSignal;
  stores: GuildGateStores;
  cache: CacheManager;
  now: Date;
}

export interface ActionRateLimit<I> {
  limit: number;
  windowMs: number;
  cost?: number;
  key?: (context: Omit<ActionContext, "signal">, input: I) => string;
}

export interface ActionIdempotency<I> {
  required?: boolean;
  ttlMs: number;
  scope?: (context: Omit<ActionContext, "signal">, input: I) => string;
}

export interface ActionConcurrency<I> {
  key: (context: Omit<ActionContext, "signal">, input: I) => string;
  ttlMs?: number;
  waitMs?: number;
}

export interface ActionDefinition<I, O> {
  name: string;
  authentication?: "required" | "optional" | "none";
  csrf?: "required" | "disabled";
  timeoutMs?: number;
  parse?: (value: unknown) => I;
  resource?: (input: I) => ResourceRef | undefined;
  rateLimit?: ActionRateLimit<I>;
  idempotency?: ActionIdempotency<I>;
  concurrency?: ActionConcurrency<I>;
  authorize?: (context: Omit<ActionContext, "signal">, input: I) => Promise<AuthorizationDecision | void> | AuthorizationDecision | void;
  execute: (context: ActionContext, input: I) => Promise<O>;
  audit?: {
    enabled?: boolean;
    changes?: (result: O, input: I) => unknown;
  };
  cache?: {
    invalidateTags?: (result: O, input: I) => string[];
  };
  realtime?: {
    delivery?: "immediate" | "outbox";
    events: (result: O, input: I) => Array<Omit<RealtimeEvent, "version" | "id" | "timestamp">>;
  };
}

export interface DefinedAction<I, O> {
  readonly definition: ActionDefinition<I, O>;
}

export function defineAction<I, O>(definition: ActionDefinition<I, O>): DefinedAction<I, O> {
  return Object.freeze({ definition });
}
