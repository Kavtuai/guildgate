import { randomToken, sha256 } from "./crypto.js";
import { errors } from "./errors.js";
import type { SessionStore } from "./stores.js";
import type { Clock, SessionRecord, SessionResolution, SupportedLocale } from "./types.js";

export interface SessionManagerOptions {
  store: SessionStore;
  clock: Clock;
  ttlMs: number;
  idleTimeoutMs: number;
  rotateAfterMs: number;
  maximumSessionsPerUser: number;
}

export interface CreateSessionInput {
  userId: string;
  locale: SupportedLocale;
  metadata?: Record<string, unknown>;
}

export class SessionManager {
  constructor(private readonly options: SessionManagerOptions) {}

  async create(input: CreateSessionInput): Promise<{ token: string; session: SessionRecord }> {
    const now = this.options.clock.now();
    const token = randomToken();
    const session = this.buildRecord(token, input, now);
    await this.options.store.set(session);
    await this.enforceSessionLimit(input.userId, session.idHash);
    return { token, session };
  }

  async resolve(token: string | undefined): Promise<SessionResolution> {
    if (!token) return { session: null };
    const now = this.options.clock.now();
    const idHash = sha256(token);
    const session = await this.options.store.get(idHash);
    if (!session) return { session: null, clearCookie: true };
    if (session.revokedAt) throw errors.sessionRevoked();
    if (new Date(session.expiresAt) <= now || new Date(session.idleExpiresAt) <= now) {
      await this.options.store.delete(idHash);
      throw errors.sessionExpired();
    }

    if (new Date(session.rotateAfter) <= now) {
      const replacement = await this.create({
        userId: session.userId,
        locale: session.locale,
        metadata: session.metadata,
      });
      await this.options.store.delete(session.idHash);
      return { session: replacement.session, replacementToken: replacement.token };
    }

    const updated: SessionRecord = {
      ...session,
      lastSeenAt: now.toISOString(),
      idleExpiresAt: new Date(now.getTime() + this.options.idleTimeoutMs).toISOString(),
    };
    await this.options.store.set(updated);
    return { session: updated };
  }

  async validate(token: string | undefined): Promise<SessionRecord | null> {
    if (!token) return null;
    const now = this.options.clock.now();
    const idHash = sha256(token);
    const session = await this.options.store.get(idHash);
    if (!session) return null;
    if (session.revokedAt || new Date(session.expiresAt) <= now || new Date(session.idleExpiresAt) <= now) {
      await this.options.store.delete(idHash);
      return null;
    }
    return session;
  }

  async revokeToken(token: string): Promise<void> {
    await this.options.store.delete(sha256(token));
  }

  async revokeHash(idHash: string): Promise<void> {
    await this.options.store.delete(idHash);
  }

  async revokeAll(userId: string): Promise<number> {
    const rows = await this.options.store.listByUser(userId);
    await Promise.all(rows.map((row) => this.options.store.delete(row.idHash)));
    return rows.length;
  }

  async list(userId: string): Promise<SessionRecord[]> {
    return this.options.store.listByUser(userId);
  }

  private buildRecord(token: string, input: CreateSessionInput, now: Date): SessionRecord {
    return {
      idHash: sha256(token),
      userId: input.userId,
      locale: input.locale,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.options.ttlMs).toISOString(),
      idleExpiresAt: new Date(now.getTime() + this.options.idleTimeoutMs).toISOString(),
      rotateAfter: new Date(now.getTime() + this.options.rotateAfterMs).toISOString(),
      metadata: input.metadata,
    };
  }

  private async enforceSessionLimit(userId: string, keepIdHash: string): Promise<void> {
    const rows = await this.options.store.listByUser(userId);
    const active = rows
      .filter((row) => row.idHash !== keepIdHash)
      .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
    const excess = Math.max(0, active.length + 1 - this.options.maximumSessionsPerUser);
    await Promise.all(active.slice(0, excess).map((row) => this.options.store.delete(row.idHash)));
  }
}
