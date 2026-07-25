import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscordPermissions,
  combinePermissions,
  computeBaseGuildPermissions,
  hasPermissions,
  missingPermissions,
  canManageTargetRole,
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
