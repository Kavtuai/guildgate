export class GuildGateError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly expose: boolean;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    code: string;
    message?: string;
    status?: number;
    retryable?: boolean;
    expose?: boolean;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message ?? input.code, { cause: input.cause });
    this.name = "GuildGateError";
    this.code = input.code;
    this.status = input.status ?? 500;
    this.retryable = input.retryable ?? false;
    this.expose = input.expose ?? this.status < 500;
    this.details = input.details;
  }
}

export function asGuildGateError(error: unknown): GuildGateError {
  if (error instanceof GuildGateError) return error;
  return new GuildGateError({
    code: "INTERNAL_ERROR",
    status: 500,
    expose: false,
    cause: error,
  });
}

export const errors = {
  configuration: (message: string) =>
    new GuildGateError({ code: "CONFIGURATION_ERROR", message, status: 500, expose: true }),
  authenticationRequired: () =>
    new GuildGateError({ code: "AUTHENTICATION_REQUIRED", status: 401 }),
  sessionExpired: () => new GuildGateError({ code: "SESSION_EXPIRED", status: 401 }),
  sessionRevoked: () => new GuildGateError({ code: "SESSION_REVOKED", status: 401 }),
  csrfInvalid: () => new GuildGateError({ code: "CSRF_INVALID", status: 403 }),
  originNotAllowed: () => new GuildGateError({ code: "ORIGIN_NOT_ALLOWED", status: 403 }),
  guildAccessDenied: () => new GuildGateError({ code: "GUILD_ACCESS_DENIED", status: 403 }),
  userPermissionMissing: (permissions?: string[]) =>
    new GuildGateError({ code: "USER_PERMISSION_MISSING", status: 403, details: { permissions } }),
  botPermissionMissing: (permissions?: string[]) =>
    new GuildGateError({ code: "BOT_PERMISSION_MISSING", status: 409, details: { permissions } }),
  botNotInGuild: () => new GuildGateError({ code: "BOT_NOT_IN_GUILD", status: 409 }),
  rateLimited: (retryAfterMs: number) =>
    new GuildGateError({
      code: "RATE_LIMITED",
      status: 429,
      retryable: true,
      details: { retryAfterMs },
    }),
  inputInvalid: (details?: Record<string, unknown>) =>
    new GuildGateError({ code: "INPUT_INVALID", status: 400, details }),
  idempotencyRequired: () => new GuildGateError({ code: "IDEMPOTENCY_KEY_REQUIRED", status: 400 }),
  idempotencyConflict: () => new GuildGateError({ code: "IDEMPOTENCY_CONFLICT", status: 409 }),
  idempotencyInflight: () =>
    new GuildGateError({ code: "IDEMPOTENCY_INFLIGHT", status: 409, retryable: true }),
  idempotencyReservationLost: () =>
    new GuildGateError({ code: "IDEMPOTENCY_RESERVATION_LOST", status: 409, retryable: true }),
  revisionConflict: (details?: Record<string, unknown>) =>
    new GuildGateError({ code: "REVISION_CONFLICT", status: 409, details }),
  lockUnavailable: () =>
    new GuildGateError({ code: "RESOURCE_BUSY", status: 409, retryable: true }),
  lockLost: (details?: Record<string, unknown>) =>
    new GuildGateError({ code: "LOCK_OWNERSHIP_LOST", status: 409, retryable: true, details }),
  ownerRequired: () =>
    new GuildGateError({ code: "OWNER_REQUIRED", status: 403 }),
  ratePolicyResetDenied: (policy: string) =>
    new GuildGateError({ code: "RATE_POLICY_RESET_DENIED", status: 403, details: { policy } }),
  timeout: () => new GuildGateError({ code: "UPSTREAM_TIMEOUT", status: 504, retryable: true }),
  requestAborted: () => new GuildGateError({ code: "REQUEST_ABORTED", status: 499, retryable: true }),
  upstreamUnavailable: (details?: Record<string, unknown>) =>
    new GuildGateError({ code: "UPSTREAM_UNAVAILABLE", status: 503, retryable: true, details }),
  maintenance: (reason?: string) =>
    new GuildGateError({ code: "MAINTENANCE_MODE", status: 503, retryable: true, details: { reason } }),
  subjectBlocked: (reason?: string) =>
    new GuildGateError({ code: "SUBJECT_BLOCKED", status: 403, details: { reason } }),
  oauthStateInvalid: () => new GuildGateError({ code: "OAUTH_STATE_INVALID", status: 400 }),
  oauthFailed: (details?: Record<string, unknown>) =>
    new GuildGateError({ code: "OAUTH_FAILED", status: 502, retryable: true, details }),
};
