import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function randomToken(bytes = 32): string {
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
  if (value === undefined) return '{"$undefined":true}';
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : `{"$number":${JSON.stringify(String(value))}}`;
  }
  if (typeof value === "bigint") return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (value instanceof Date) return `{"$date":${JSON.stringify(value.toISOString())}}`;
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value !== "object") throw new TypeError(`Unsupported stable value type: ${typeof value}`);
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`).join(",")}}`;
}

export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export function createTokenCipher(input: { keys: Record<string, string | Uint8Array>; activeKeyId: string }): TokenCipher {
  const active = input.keys[input.activeKeyId];
  if (!active) throw new Error(`Unknown active key id: ${input.activeKeyId}`);

  const normalizeKey = (value: string | Uint8Array): Buffer => {
    const raw = typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
    if (raw.length !== 32) throw new Error("Encryption keys must decode to 32 bytes");
    return raw;
  };

  const keyring = new Map(Object.entries(input.keys).map(([id, key]) => [id, normalizeKey(key)]));

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", normalizeKey(active), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ["v1", input.activeKeyId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    decrypt(payload: string): string {
      const [version, keyId, ivText, tagText, ciphertextText] = payload.split(".");
      if (version !== "v1" || !keyId || !ivText || !tagText || !ciphertextText) {
        throw new Error("Invalid encrypted token payload");
      }
      const key = keyring.get(keyId);
      if (!key) throw new Error(`Unknown encryption key id: ${keyId}`);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
      decipher.setAuthTag(Buffer.from(tagText, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

export function redactValue(value: unknown, sensitiveKeys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, sensitiveKeys));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKeys.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(item, sensitiveKeys);
  }
  return output;
}
