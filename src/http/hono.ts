import type { DefinedAction } from "../action.js";
import type { GuildGateKernel } from "../kernel.js";
import type { RequestEnvelope } from "../types.js";
import { parseHttpMethod } from "../security.js";

export interface HonoRequestLike {
  method: string;
  url: string;
  header(name: string): string | undefined;
  json?(): Promise<unknown>;
  param?(): Record<string, string>;
  query?(): Record<string, string>;
  raw?: Request;
}

export interface HonoContextLike {
  req: HonoRequestLike;
  header(name: string, value: string, options?: { append?: boolean }): void;
  json(payload: unknown, status?: number): Response;
}

export function createHonoHandler<I, O>(
  kernel: GuildGateKernel,
  action: DefinedAction<I, O>,
  options?: {
    input?: (context: HonoContextLike) => unknown | Promise<unknown>;
    locale?: (context: HonoContextLike) => string | undefined;
    cookies?: (context: HonoContextLike) => Record<string, string | undefined>;
    ip?: (context: HonoContextLike) => string | undefined;
  },
): (context: HonoContextLike) => Promise<Response> {
  return async (context) => {
    const url = new URL(context.req.url);
    const cookies = options?.cookies?.(context) ?? parseCookies(context.req.header("cookie"));
    const input = options?.input
      ? await options.input(context)
      : context.req.json
        ? await context.req.json().catch(() => undefined)
        : undefined;
    const envelope: RequestEnvelope = {
      method: parseHttpMethod(context.req.method),
      path: url.pathname,
      input,
      headers: headerRecord(context.req),
      cookies,
      ip: options?.ip?.(context),
      origin: context.req.header("origin"),
      userAgent: context.req.header("user-agent"),
      locale: options?.locale?.(context) ?? context.req.header("accept-language"),
      sessionToken: cookies[kernel.cookie.name],
      csrfToken: context.req.header("x-csrf-token"),
      idempotencyKey: context.req.header("idempotency-key"),
      signal: context.req.raw?.signal,
    };
    const result = await kernel.execute(action, envelope);
    applyMeta(kernel, context, result.meta);
    if (!result.ok) {
      if (typeof result.error.details?.retryAfterMs === "number") {
        context.header("Retry-After", String(Math.max(1, Math.ceil(result.error.details.retryAfterMs / 1000))));
      }
      return context.json({
        error: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
          details: result.error.details,
          requestId: result.meta.requestId,
        },
      }, result.error.status);
    }
    return context.json({ data: result.data, requestId: result.meta.requestId }, 200);
  };
}

function applyMeta(kernel: GuildGateKernel, context: HonoContextLike, meta: {
  replacementSessionToken?: string;
  replacementCsrfToken?: string;
  clearSessionCookie?: boolean;
  requestId: string;
  rateLimit?: { limit: number; remaining: number; resetAtMs: number };
  postCommitIssues?: unknown[];
}): void {
  context.header("X-Request-Id", meta.requestId);
  if (meta.clearSessionCookie) context.header("Set-Cookie", kernel.clearSessionCookie(), { append: true });
  if (meta.replacementSessionToken) context.header("Set-Cookie", kernel.sessionCookie(meta.replacementSessionToken), { append: true });
  if (meta.replacementCsrfToken) context.header("X-CSRF-Token", meta.replacementCsrfToken);
  if (meta.postCommitIssues?.length) context.header("X-GuildGate-Post-Commit-Issues", String(meta.postCommitIssues.length));
  if (meta.rateLimit) {
    context.header("RateLimit-Limit", String(meta.rateLimit.limit));
    context.header("RateLimit-Remaining", String(meta.rateLimit.remaining));
    context.header("RateLimit-Reset", String(Math.ceil(meta.rateLimit.resetAtMs / 1000)));
  }
}

function headerRecord(request: HonoRequestLike): Record<string, string | undefined> {
  const names = ["origin", "user-agent", "accept-language", "cookie", "x-csrf-token", "idempotency-key"];
  return Object.fromEntries(names.map((name) => [name, request.header(name)]));
}

function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part.trim(), ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}
