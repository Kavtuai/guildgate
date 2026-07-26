import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager, createMemoryStoreBundle } from "../dist/index.js";
import {
  DiscordPermissions,
  combinePermissions,
  computeBaseGuildPermissions,
  hasPermissions,
  missingPermissions,
  canManageTargetRole,
  createDiscordGuildAuthorizer,
} from "../dist/discord.js";

test("Discord permissions use BigInt without numeric truncation", () => {
  const bits = combinePermissions(["MANAGE_GUILD", "MANAGE_ROLES", "BYPASS_SLOWMODE"]);
  assert.equal(hasPermissions(bits.toString(), ["MANAGE_GUILD", "BYPASS_SLOWMODE"]), true);
  assert.deepEqual(missingPermissions(bits.toString(), ["BAN_MEMBERS", "MANAGE_ROLES"]), ["BAN_MEMBERS"]);
  assert.equal((bits & DiscordPermissions.BYPASS_SLOWMODE) !== 0n, true);
});

test("base guild permissions include everyone and member roles", () => {
  const permissions = computeBaseGuildPermissions({
    guildId: "guild-1",
    memberId: "bot-1",
    roleIds: ["role-1"],
    roles: [
      { id: "guild-1", position: 0, permissions: DiscordPermissions.VIEW_CHANNEL.toString() },
      { id: "role-1", position: 5, permissions: DiscordPermissions.MANAGE_MESSAGES.toString() },
    ],
  });
  assert.equal(hasPermissions(permissions, ["VIEW_CHANNEL", "MANAGE_MESSAGES"]), true);
  assert.equal(canManageTargetRole({
    actorRoleIds: ["role-1"],
    targetRolePosition: 4,
    roles: [{ id: "role-1", position: 5, permissions: "0" }],
  }), true);
});


test("Discord guild authorizer caches inspection and evaluates user and bot permissions", async () => {
  const stores = createMemoryStoreBundle();
  const cache = new CacheManager(stores.cache, stores.locks);
  let accessTokenCalls = 0;
  let fetchCalls = 0;
  const roles = [
    { id: "guild-1", position: 0, permissions: DiscordPermissions.VIEW_CHANNEL.toString() },
    { id: "bot-role", position: 5, permissions: DiscordPermissions.MANAGE_MESSAGES.toString() },
  ];
  const authorizer = createDiscordGuildAuthorizer({
    oauth: {
      async getAccessToken() { accessTokenCalls += 1; return "access"; },
    },
    botToken: "bot-token",
    botUserId: "bot-user",
    cache,
    async fetch(url, init) {
      fetchCalls += 1;
      const target = new URL(String(url));
      assert.match(init.headers.authorization, /^(Bearer access|Bot bot-token)$/);
      if (target.pathname.endsWith("/users/@me/guilds")) {
        return Response.json([{ id: "guild-1", name: "Guild", owner: false, permissions: DiscordPermissions.MANAGE_GUILD.toString() }]);
      }
      if (target.pathname.endsWith("/guilds/guild-1")) return Response.json({ id: "guild-1", owner_id: "owner" });
      if (target.pathname.endsWith("/guilds/guild-1/members/bot-user")) return Response.json({ user: { id: "bot-user" }, roles: ["bot-role"] });
      if (target.pathname.endsWith("/guilds/guild-1/roles")) return Response.json(roles);
      return new Response("not found", { status: 404 });
    },
  });

  const first = await authorizer.inspect({ userId: "user", guildId: "guild-1", consistency: "cached" });
  const second = await authorizer.inspect({ userId: "user", guildId: "guild-1", consistency: "cached" });
  assert.deepEqual(first, second);
  assert.equal(first.bot.present, true);
  assert.equal(hasPermissions(first.bot.permissions, ["VIEW_CHANNEL", "MANAGE_MESSAGES"]), true);
  assert.equal(accessTokenCalls, 1);
  assert.equal(fetchCalls, 4);

  const requireAccess = authorizer.require({
    guildId: (value) => value.guildId,
    userPermissions: ["MANAGE_GUILD"],
    botPermissions: ["MANAGE_MESSAGES"],
    consistency: "cached",
  });
  assert.deepEqual(await requireAccess({ userId: "user" }, { guildId: "guild-1" }), { allowed: true });
  assert.deepEqual(await requireAccess({}, { guildId: "guild-1" }), { allowed: false, code: "AUTHENTICATION_REQUIRED" });
});

test("Discord guild authorizer distinguishes missing access, absent bots and missing permissions", async () => {
  const stores = createMemoryStoreBundle();
  const cache = new CacheManager(stores.cache, stores.locks);
  const make = (userGuilds, memberStatus = 404) => createDiscordGuildAuthorizer({
    oauth: { async getAccessToken() { return "access"; } },
    botToken: "bot-token",
    botUserId: "bot-user",
    cache,
    async fetch(url) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/users/@me/guilds")) return Response.json(userGuilds);
      if (path.endsWith("/guilds/guild-2")) return Response.json({ id: "guild-2", owner_id: "owner" });
      if (path.endsWith("/guilds/guild-2/members/bot-user")) return new Response("missing", { status: memberStatus });
      if (path.endsWith("/guilds/guild-2/roles")) return Response.json([{ id: "guild-2", position: 0, permissions: "0" }]);
      return new Response("not found", { status: 404 });
    },
  });

  await assert.rejects(
    make([]).inspect({ userId: "user", guildId: "guild-2", consistency: "live" }),
    (error) => error?.code === "GUILD_ACCESS_DENIED",
  );

  const authorizer = make([{ id: "guild-2", name: "Guild", owner: false, permissions: "0" }]);
  const inspect = await authorizer.inspect({ userId: "user", guildId: "guild-2", consistency: "live" });
  assert.equal(inspect.bot.present, false);
  const missingUser = authorizer.require({ guildId: (value) => value.guildId, userPermissions: ["MANAGE_GUILD"] });
  assert.deepEqual(await missingUser({ userId: "user" }, { guildId: "guild-2" }), {
    allowed: false,
    code: "USER_PERMISSION_MISSING",
    details: { permissions: ["MANAGE_GUILD"] },
  });

  const botAbsent = make([{ id: "guild-2", name: "Guild", owner: true, permissions: "0" }]).require({
    guildId: (value) => value.guildId,
    botPermissions: ["MANAGE_MESSAGES"],
  });
  assert.deepEqual(await botAbsent({ userId: "owner" }, { guildId: "guild-2" }), { allowed: false, code: "BOT_NOT_IN_GUILD" });
});
