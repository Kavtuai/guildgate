import { errors } from "./errors.js";
import { hasPermissions, missingPermissions, type DiscordPermissionName } from "./discord/permissions.js";
import type { AuthorizationDecision } from "./action.js";

export interface DiscordJsGuildLike {
  id: string;
  ownerId?: string;
  members?: {
    me?: DiscordJsMemberLike | null;
    fetch(userId: string): Promise<DiscordJsMemberLike>;
  };
}

export interface DiscordJsMemberLike {
  id: string;
  permissions: { bitfield?: bigint | number | string; has?(permission: bigint | number | string): boolean } | bigint | number | string;
  roles?: { highest?: { position?: number }; cache?: { values?(): Iterable<{ id: string; position?: number }> } };
}

export interface DiscordJsClientLike {
  guilds: {
    cache?: { get(id: string): DiscordJsGuildLike | undefined };
    fetch(id: string): Promise<DiscordJsGuildLike>;
  };
  user?: { id: string } | null;
  isReady?(): boolean;
  ws?: { ping?: number };
}

export function createDiscordJsGuildAdapter(client: DiscordJsClientLike) {
  return {
    async getGuild(guildId: string): Promise<DiscordJsGuildLike> {
      return client.guilds.cache?.get(guildId) ?? client.guilds.fetch(guildId).catch(() => { throw errors.botNotInGuild(); });
    },
    async getMember(guildId: string, userId: string): Promise<DiscordJsMemberLike> {
      const guild = await this.getGuild(guildId);
      if (!guild.members) throw errors.guildAccessDenied();
      return guild.members.fetch(userId).catch(() => { throw errors.guildAccessDenied(); });
    },
    async authorize(input: {
      guildId: string;
      userId: string;
      userPermissions?: DiscordPermissionName[];
      botPermissions?: DiscordPermissionName[];
      allowGuildOwner?: boolean;
    }): Promise<AuthorizationDecision> {
      const guild = await this.getGuild(input.guildId);
      const member = await this.getMember(input.guildId, input.userId);
      const botMember = guild.members?.me;
      if (!botMember) return { allowed: false, code: "BOT_NOT_IN_GUILD" };
      if (input.allowGuildOwner !== false && guild.ownerId === input.userId) return { allowed: true };
      const userBits = permissionBits(member.permissions);
      if (input.userPermissions !== undefined && !hasPermissions(userBits, input.userPermissions)) {
        return { allowed: false, code: "USER_PERMISSION_MISSING", details: { permissions: missingPermissions(userBits, input.userPermissions) } };
      }
      const botBits = permissionBits(botMember.permissions);
      if (input.botPermissions !== undefined && !hasPermissions(botBits, input.botPermissions)) {
        return { allowed: false, code: "BOT_PERMISSION_MISSING", details: { permissions: missingPermissions(botBits, input.botPermissions) } };
      }
      return { allowed: true };
    },
    status() {
      let guildCount = 0;
      const cache = client.guilds.cache as { size?: number } | undefined;
      guildCount = cache?.size ?? 0;
      return {
        ready: client.isReady?.() ?? Boolean(client.user),
        botId: client.user?.id,
        guildCount,
        websocketPingMs: client.ws?.ping,
      };
    },
  };
}

function permissionBits(value: DiscordJsMemberLike["permissions"]): bigint {
  if (typeof value === "object") {
    if (value.bitfield !== undefined) return BigInt(value.bitfield);
    return 0n;
  }
  return BigInt(value);
}
