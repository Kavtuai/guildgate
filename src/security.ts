import { hmacSha256, randomToken, safeEqualText } from "./crypto.js";
import { errors } from "./errors.js";
import type { EnvironmentName, HttpMethod } from "./types.js";

const unsafeMethods = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: HttpMethod): boolean {
  return unsafeMethods.has(method);
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function assertAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): void {
  if (!origin) throw errors.originNotAllowed();
  try {
    if (!allowedOrigins.has(normalizeOrigin(origin))) throw errors.originNotAllowed();
  } catch (error) {
    if (error instanceof Error && error.name === "GuildGateError") throw error;
    throw errors.originNotAllowed();
  }
}

export function validateAllowedOrigins(origins: string[], environment: EnvironmentName): Set<string> {
  if (environment === "production" && origins.length === 0) {
    throw errors.configuration("At least one allowed origin is required in production");
  }
  const normalized = origins.map(normalizeOrigin);
  if (environment === "production") {
    for (const origin of normalized) {
      const url = new URL(origin);
      if (url.protocol !== "https:") throw errors.configuration("Production origins must use HTTPS");
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        throw errors.configuration("Production origins cannot point to localhost");
      }
    }
  }
  return new Set(normalized);
}

export interface CsrfService {
  issue(sessionIdHash: string): string;
  verify(sessionIdHash: string, token: string | undefined): boolean;
}

export function createCsrfService(secret: string): CsrfService {
  if (Buffer.byteLength(secret) < 32) throw errors.configuration("CSRF secret must contain at least 32 bytes");
  return {
    issue(sessionIdHash) {
      const nonce = randomToken(24);
      return `${nonce}.${hmacSha256(secret, `${sessionIdHash}.${nonce}`)}`;
    },
    verify(sessionIdHash, token) {
      if (!token) return false;
      const [nonce, signature] = token.split(".");
      if (!nonce || !signature) return false;
      return safeEqualText(signature, hmacSha256(secret, `${sessionIdHash}.${nonce}`));
    },
  };
}

export interface CookieConfig {
  name: string;
  path: string;
  secure: boolean;
  sameSite: "Lax" | "Strict";
  maxAgeSeconds: number;
}

export function validateCookieConfig(config: CookieConfig): void {
  if (!config.name || /[\s;,=]/.test(config.name)) {
    throw errors.configuration("Session cookie name is invalid");
  }
  if (!config.path.startsWith("/")) throw errors.configuration("Session cookie path must start with /");
  if (config.name.startsWith("__Host-") && (!config.secure || config.path !== "/")) {
    throw errors.configuration("__Host- cookies require Secure and Path=/");
  }
  if (config.name.startsWith("__Secure-") && !config.secure) {
    throw errors.configuration("__Secure- cookies require Secure");
  }
}

export function serializeSessionCookie(value: string, config: CookieConfig): string {
  validateCookieConfig(config);
  return [
    `${config.name}=${encodeURIComponent(value)}`,
    `Path=${config.path}`,
    `Max-Age=${config.maxAgeSeconds}`,
    "HttpOnly",
    config.secure ? "Secure" : "",
    `SameSite=${config.sameSite}`,
  ].filter(Boolean).join("; ");
}

export function serializeClearedCookie(config: CookieConfig): string {
  validateCookieConfig(config);
  return [
    `${config.name}=`,
    `Path=${config.path}`,
    "Max-Age=0",
    "HttpOnly",
    config.secure ? "Secure" : "",
    `SameSite=${config.sameSite}`,
  ].filter(Boolean).join("; ");
}
