import { errors } from "./errors.js";

export interface AuditCursorValue {
  createdAt: string;
  id: string;
}

export function encodeAuditCursor(value: AuditCursorValue): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: value.createdAt, id: value.id }), "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string | undefined): AuditCursorValue | undefined {
  if (!cursor) return undefined;
  if (cursor.length > 1_024) throw errors.inputInvalid({ field: "cursor" });
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<AuditCursorValue> & { v?: number };
    if (parsed.v !== 1 || typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !parsed.id) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw errors.inputInvalid({ field: "cursor" });
  }
}

export function compareAuditRowsDescending(
  left: AuditCursorValue,
  right: AuditCursorValue,
): number {
  const byTime = right.createdAt.localeCompare(left.createdAt);
  return byTime || right.id.localeCompare(left.id);
}

export function isAfterAuditCursor(row: AuditCursorValue, cursor: AuditCursorValue): boolean {
  return row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row.id < cursor.id);
}
