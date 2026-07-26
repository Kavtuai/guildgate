import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const maximumStructuredDepth = 64;
const maximumCiphertextBytes = 64 * 1024;

export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 1024) {
    throw new TypeError("Token size must be an integer between 16 and 1024 bytes");
  }
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}

export function hmacSha256(secret: string | Uint8Array, value: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(value);
  return hmac.digest("base64url");
}

export function safeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function stableStringify(value: unknown): string {
  return stableValue(value, new WeakSet<object>(), 0);
}

function stableValue(value: unknown, seen: WeakSet<object>, depth: number): string {
  if (depth > maximumStructuredDepth) throw new TypeError("Structured value exceeds the maximum depth");
  if (value === undefined) return '{"$undefined":true}';
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : `{"$number":${JSON.stringify(String(value))}}`;
  }
  if (typeof value === "bigint") return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (value instanceof Date) return `{"$date":${JSON.stringify(value.toISOString())}}`;
  if (typeof value !== "object") throw new TypeError(`Unsupported stable value type: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("Structured value contains a circular reference");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => stableValue(item, seen, depth + 1)).join(",")}]`;
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableValue(source[key], seen, depth + 1)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export function createTokenCipher(input: { keys: Record<string, string | Uint8Array>; activeKeyId: string }): TokenCipher {
  const active = input.keys[input.activeKeyId];
  if (!active) throw new Error(`Unknown active key id: ${input.activeKeyId}`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.activeKeyId)) throw new Error("Encryption key ids must be URL-safe and at most 64 characters");

  const normalizeKey = (value: string | Uint8Array): Buffer => {
    const raw = typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
    if (raw.length !== 32) throw new Error("Encryption keys must decode to 32 bytes");
    return raw;
  };

  const keyring = new Map(Object.entries(input.keys).map(([id, key]) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Encryption key ids must be URL-safe and at most 64 characters");
    return [id, normalizeKey(key)] as const;
  }));
  const activeKey = normalizeKey(active);

  return {
    encrypt(plaintext: string): string {
      if (Buffer.byteLength(plaintext) > maximumCiphertextBytes) {
        throw new Error(`Token plaintext exceeds ${maximumCiphertextBytes} bytes`);
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", activeKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ["v1", input.activeKeyId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    decrypt(payload: string): string {
      if (Buffer.byteLength(payload) > maximumCiphertextBytes * 2) throw new Error("Encrypted token payload is too large");
      const parts = payload.split(".");
      if (parts.length !== 5) throw new Error("Invalid encrypted token payload");
      const [version, keyId, ivText, tagText, ciphertextText] = parts;
      if (version !== "v1" || !keyId || !ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted token payload");
      const key = keyring.get(keyId);
      if (!key) throw new Error(`Unknown encryption key id: ${keyId}`);
      const iv = Buffer.from(ivText, "base64url");
      const tag = Buffer.from(tagText, "base64url");
      const ciphertext = Buffer.from(ciphertextText, "base64url");
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > maximumCiphertextBytes) throw new Error("Invalid encrypted token payload");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    },
  };
}

export function redactValue(value: unknown, sensitiveKeys: Set<string>): unknown {
  const normalizedKeys = new Set([...sensitiveKeys].map(normalizeSensitiveKey));
  return redactStructured(value, normalizedKeys, new WeakSet<object>(), 0);
}

function redactStructured(value: unknown, sensitiveKeys: Set<string>, seen: WeakSet<object>, depth: number): unknown {
  if (depth > maximumStructuredDepth) return "[MAX_DEPTH]";
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactStructured(item, sensitiveKeys, seen, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sensitiveKeys.has(normalizeSensitiveKey(key))
        ? "[REDACTED]"
        : redactStructured(item, sensitiveKeys, seen, depth + 1);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function normalizeSensitiveKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
