import type { DefinedAction } from "../action.js";
import type { GuildGateKernel } from "../kernel.js";
import type { RequestEnvelope } from "../types.js";
import { parseHttpMethod } from "../security.js";

export interface FastifyRequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
  body?: unknown;
  params?: unknown;
  query?: unknown;
  raw?: unknown;
}

export interface FastifyReplyLike {
  code(status: number): FastifyReplyLike;
  header(name: string, value: string | number): FastifyReplyLike;
  send(payload: unknown): unknown;
}

export function createFastifyHandler<I, O>(
  kernel: GuildGateKernel,
  action: DefinedAction<I, O>,
  options?: {
    input?: (request: FastifyRequestLike) => unknown;
    locale?: (request: FastifyRequestLike) => string | undefined;
    signal?: (request: FastifyRequestLike) => AbortSignal | undefined;
  },
): (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown> {
  return async (request, reply) => {
    const envelope: RequestEnvelope = {
      method: parseHttpMethod(request.method),
      path: request.url.split("?")[0] ?? request.url,
      input: options?.input?.(request) ?? request.body,
      headers: request.headers,
      cookies: request.cookies,
      ip: request.ip,
      origin: header(request.headers, "origin"),
      userAgent: header(request.headers, "user-agent"),
      locale: options?.locale?.(request) ?? header(request.headers, "accept-language"),
      sessionToken: request.cookies?.[kernel.cookie.name],
      csrfToken: header(request.headers, "x-csrf-token"),
      idempotencyKey: header(request.headers, "idempotency-key"),
      signal: options?.signal?.(request) ?? rawSignal(request.raw),
    };
    const result = await kernel.execute(action, envelope);
    applyMeta(kernel, reply, result.meta);
    if (!result.ok) {
      if (result.error.details?.retryAfterMs && typeof result.error.details.retryAfterMs === "number") {
        reply.header("Retry-After", Math.max(1, Math.ceil(result.error.details.retryAfterMs / 1000)));
      }
      return reply.code(result.error.status).send({
        error: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
          details: result.error.details,
          requestId: result.meta.requestId,
        },
      });
    }
    return reply.code(200).send({ data: result.data, requestId: result.meta.requestId });
  };
}

function applyMeta(
  kernel: GuildGateKernel,
  reply: FastifyReplyLike,
  meta: { replacementSessionToken?: string; replacementCsrfToken?: string; clearSessionCookie?: boolean; requestId: string; rateLimit?: { limit: number; remaining: number; resetAtMs: number }; postCommitIssues?: unknown[] },
): void {
  reply.header("X-Request-Id", meta.requestId);
  if (meta.clearSessionCookie) reply.header("Set-Cookie", kernel.clearSessionCookie());
  if (meta.replacementSessionToken) reply.header("Set-Cookie", kernel.sessionCookie(meta.replacementSessionToken));
  if (meta.replacementCsrfToken) reply.header("X-CSRF-Token", meta.replacementCsrfToken);
  if (meta.postCommitIssues?.length) reply.header("X-GuildGate-Post-Commit-Issues", meta.postCommitIssues.length);
  if (meta.rateLimit) {
    reply.header("RateLimit-Limit", meta.rateLimit.limit);
    reply.header("RateLimit-Remaining", meta.rateLimit.remaining);
    reply.header("RateLimit-Reset", Math.ceil(meta.rateLimit.resetAtMs / 1000));
  }
}

function header(headers: FastifyRequestLike["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function rawSignal(raw: unknown): AbortSignal | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const signal = (raw as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}
