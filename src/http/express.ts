import type { DefinedAction } from "../action.js";
import type { GuildGateKernel } from "../kernel.js";
import type { RequestEnvelope } from "../types.js";
import { parseHttpMethod } from "../security.js";

export interface ExpressRequestLike {
  method: string;
  path: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
  body?: unknown;
  params?: unknown;
  query?: unknown;
}

export interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  setHeader(name: string, value: string | number): void;
  json(payload: unknown): unknown;
}

export type ExpressNextLike = (error?: unknown) => void;

export function createExpressHandler<I, O>(
  kernel: GuildGateKernel,
  action: DefinedAction<I, O>,
  options?: {
    input?: (request: ExpressRequestLike) => unknown;
    locale?: (request: ExpressRequestLike) => string | undefined;
  },
): (request: ExpressRequestLike, response: ExpressResponseLike, next: ExpressNextLike) => Promise<void> {
  return async (request, response, next) => {
    try {
      const envelope: RequestEnvelope = {
        method: parseHttpMethod(request.method),
        path: request.path || request.originalUrl || "/",
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
      };
      const result = await kernel.execute(action, envelope);
      response.setHeader("X-Request-Id", result.meta.requestId);
      if (result.meta.clearSessionCookie) response.setHeader("Set-Cookie", kernel.clearSessionCookie());
      if (result.meta.replacementSessionToken) response.setHeader("Set-Cookie", kernel.sessionCookie(result.meta.replacementSessionToken));
      if (result.meta.replacementCsrfToken) response.setHeader("X-CSRF-Token", result.meta.replacementCsrfToken);
      if (result.meta.postCommitIssues?.length) {
        response.setHeader("X-GuildGate-Post-Commit-Issues", result.meta.postCommitIssues.length);
      }
      if (result.meta.rateLimit) {
        response.setHeader("RateLimit-Limit", result.meta.rateLimit.limit);
        response.setHeader("RateLimit-Remaining", result.meta.rateLimit.remaining);
        response.setHeader("RateLimit-Reset", Math.ceil(result.meta.rateLimit.resetAtMs / 1000));
      }
      if (!result.ok) {
        if (result.error.details?.retryAfterMs && typeof result.error.details.retryAfterMs === "number") {
          response.setHeader("Retry-After", Math.max(1, Math.ceil(result.error.details.retryAfterMs / 1000)));
        }
        response.status(result.error.status).json({
          error: {
            code: result.error.code,
            message: result.error.message,
            retryable: result.error.retryable,
            details: result.error.details,
            requestId: result.meta.requestId,
          },
        });
        return;
      }
      response.status(200).json({ data: result.data, requestId: result.meta.requestId });
    } catch (error) {
      next(error);
    }
  };
}

function header(headers: ExpressRequestLike["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
