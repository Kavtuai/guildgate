import { isIP } from "node:net";
import { hmacSha256, randomToken, safeEqualText } from "./crypto.js";
import { errors } from "./errors.js";
import type { EnvironmentName, HttpMethod } from "./types.js";

const unsafeMethods = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: HttpMethod): boolean {
  return unsafeMethods.has(method);
}

export function parseHttpMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  if (!["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw errors.inputInvalid({ field: "method" });
  }
  return method as HttpMethod;
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
      if (isLoopbackOrUnspecifiedHost(url.hostname)) {
        throw errors.configuration("Production origins cannot point to a loopback or unspecified host");
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
  if (!config.path.startsWith("/") || /[\r\n;]/.test(config.path)) throw errors.configuration("Session cookie path is invalid");
  if (!Number.isInteger(config.maxAgeSeconds) || config.maxAgeSeconds < 1 || config.maxAgeSeconds > 31_536_000) {
    throw errors.configuration("Session cookie maxAgeSeconds must be an integer between 1 and 31536000");
  }
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

export function isLoopbackOrUnspecifiedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (isIP(host) === 4) return isLoopbackOrUnspecifiedIpv4(host);
  if (isIP(host) === 6) {
    if (host === "::1" || host === "::") return true;
    const mapped = ipv4MappedAddress(host);
    return mapped ? isLoopbackOrUnspecifiedIpv4(mapped) : false;
  }
  return false;
}


function isLoopbackOrUnspecifiedIpv4(address: string): boolean {
  const first = Number(address.split(".")[0]);
  return first === 127 || first === 0;
}

function ipv4MappedAddress(address: string): string | undefined {
  if (!address.startsWith("::ffff:")) return undefined;
  const suffix = address.slice("::ffff:".length);
  if (suffix.includes(".")) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2) return undefined;
  const high = Number.parseInt(groups[0] ?? "", 16);
  const low = Number.parseInt(groups[1] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) return undefined;
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}
