import type { CacheManager } from "../cache.js";
import { errors } from "../errors.js";
import type { AuthorizationDecision, ActionContext } from "../action.js";
import type { DiscordOAuthClient, DiscordPartialGuild } from "./oauth.js";
import {
  computeBaseGuildPermissions,
  missingPermissions,
  type DiscordPermissionName,
  type DiscordRoleLike,
} from "./permissions.js";

interface DiscordMemberResponse {
  user?: { id: string };
  roles: string[];
}

interface DiscordGuildResponse {
  id: string;
  owner_id: string;
}

export interface DiscordGuildAccess {
  guildId: string;
  user: {
    owner: boolean;
    permissions: string;
  };
  bot: {
    present: boolean;
    permissions: string;
    roleIds: string[];
    roles: DiscordRoleLike[];
  };
}

export interface DiscordGuildAuthorizer {
  inspect(input: { userId: string; guildId: string; consistency?: "cached" | "live"; signal?: AbortSignal }): Promise<DiscordGuildAccess>;
  require<I>(input: {
    guildId: (value: I) => string;
    userPermissions?: DiscordPermissionName[];
    botPermissions?: DiscordPermissionName[];
    consistency?: "cached" | "live";
  }): (context: Omit<ActionContext, "signal">, value: I) => Promise<AuthorizationDecision>;
}

export function createDiscordGuildAuthorizer(input: {
  oauth: DiscordOAuthClient;
  botToken: string;
  botUserId: string;
  cache: CacheManager;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  cachedTtlMs?: number;
}): DiscordGuildAuthorizer {
  const fetcher = input.fetch ?? globalThis.fetch;
  const apiBase = input.apiBaseUrl ?? "https://discord.com/api/v10";

  const inspect: DiscordGuildAuthorizer["inspect"] = async (request) => {
    const load = (cacheSignal?: AbortSignal) => loadAccess(
      request.userId,
      request.guildId,
      combineSignals(request.signal, cacheSignal),
    );
    if (request.consistency === "live") return load(request.signal);
    return input.cache.remember({
      key: `discord-access:${request.userId}:${request.guildId}`,
      ttlMs: input.cachedTtlMs ?? 20_000,
      tags: [`discord-access:${request.userId}`, `guild:${request.guildId}`],
      load,
    });
  };

  return {
    inspect,

    require(requirement) {
      return async (context, value) => {
        if (!context.userId) return { allowed: false, code: "AUTHENTICATION_REQUIRED" };
        const guildId = requirement.guildId(value);
        const access = await inspect({
          userId: context.userId,
          guildId,
          consistency: requirement.consistency ?? "live",
        });
        const missingUser = missingPermissions(access.user.permissions, requirement.userPermissions ?? ["MANAGE_GUILD"], {
          owner: access.user.owner,
        });
        if (missingUser.length) return { allowed: false, code: "USER_PERMISSION_MISSING", details: { permissions: missingUser } };
        if (!access.bot.present) return { allowed: false, code: "BOT_NOT_IN_GUILD" };
        const missingBot = missingPermissions(access.bot.permissions, requirement.botPermissions ?? []);
        if (missingBot.length) return { allowed: false, code: "BOT_PERMISSION_MISSING", details: { permissions: missingBot } };
        return { allowed: true };
      };
    },
  };

  async function loadAccess(userId: string, guildId: string, signal?: AbortSignal): Promise<DiscordGuildAccess> {
    const accessToken = await input.oauth.getAccessToken(userId);
    const userGuilds = await discordGet<DiscordPartialGuild[]>("/users/@me/guilds", `Bearer ${accessToken}`, signal);
    const userGuild = userGuilds.find((guild) => guild.id === guildId);
    if (!userGuild) throw errors.guildAccessDenied();

    const [guild, member, roles] = await Promise.all([
      discordGet<DiscordGuildResponse>(`/guilds/${guildId}`, `Bot ${input.botToken}`, signal),
      discordGet<DiscordMemberResponse>(`/guilds/${guildId}/members/${input.botUserId}`, `Bot ${input.botToken}`, signal)
        .catch((error) => {
          if (error instanceof ResponseError && error.status === 404) return null;
          throw error;
        }),
      discordGet<DiscordRoleLike[]>(`/guilds/${guildId}/roles`, `Bot ${input.botToken}`, signal),
    ]);
    if (!member) {
      return {
        guildId,
        user: { owner: userGuild.owner, permissions: userGuild.permissions },
        bot: { present: false, permissions: "0", roleIds: [], roles },
      };
    }
    const permissions = computeBaseGuildPermissions({
      guildId,
      ownerId: guild.owner_id,
      memberId: input.botUserId,
      roleIds: member.roles,
      roles,
    });
    return {
      guildId,
      user: { owner: userGuild.owner, permissions: userGuild.permissions },
      bot: { present: true, permissions: permissions.toString(), roleIds: member.roles, roles },
    };
  }

  async function discordGet<T>(path: string, authorization: string, signal?: AbortSignal): Promise<T> {
    const response = await fetcher(`${apiBase}${path}`, { headers: { authorization }, signal });
    if (response.status === 429) {
      const body = await response.clone().json().catch(() => ({})) as { retry_after?: number };
      const headerSeconds = Number(response.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(headerSeconds)
        ? Math.ceil(headerSeconds * 1000)
        : Math.ceil((body.retry_after ?? 1) * 1000);
      throw errors.rateLimited(retryAfterMs);
    }
    if (!response.ok) throw new ResponseError(response.status, await response.text().catch(() => ""));
    return response.json() as Promise<T>;
  }
}

class ResponseError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Discord request failed with ${status}: ${body}`);
  }
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!active.length) return undefined;
  return active.length === 1 ? active[0] : AbortSignal.any(active);
}
