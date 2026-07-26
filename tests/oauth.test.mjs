import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTokenCipher } from "../dist/index.js";
import { createDiscordOAuth } from "../dist/discord.js";
import { createGuildGateTestHarness } from "../dist/testing.js";

function cookieValue(header) {
  return decodeURIComponent(header.split(";", 1)[0].split("=", 2)[1]);
}

test("Discord OAuth state is bound to one browser and can be consumed once", async () => {
  const harness = createGuildGateTestHarness();
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET" });
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/oauth2/token")) {
      return Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "identify guilds",
      });
    }
    if (path.endsWith("/users/@me/guilds")) {
      return Response.json([{ id: "guild-1", name: "Test", owner: true, permissions: "8" }]);
    }
    if (path.endsWith("/users/@me")) {
      return Response.json({ id: "user-1", username: "tester", locale: "tr" });
    }
    return new Response("not found", { status: 404 });
  };
  const cipher = createTokenCipher({
    activeKeyId: "test",
    keys: { test: randomBytes(32) },
  });
  const oauth = createDiscordOAuth({
    kernel: harness.kernel,
    cipher,
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "http://localhost:3000/auth/discord/callback",
      fetch,
    },
  });

  const start = await oauth.beginLogin({ returnTo: "/dashboard/settings", locale: "en" });
  const authorization = new URL(start.authorizationUrl);
  const state = authorization.searchParams.get("state");
  assert.ok(state);
  assert.equal(start.stateCookie.startsWith("guildgate.oauth="), true);

  await assert.rejects(
    oauth.completeLogin({ code: "code-1", state, stateCookie: "wrong-browser" }),
    (error) => error?.code === "OAUTH_STATE_INVALID",
  );

  const secondStart = await oauth.beginLogin({ returnTo: "https://evil.example/", locale: "en" });
  const secondUrl = new URL(secondStart.authorizationUrl);
  const secondState = secondUrl.searchParams.get("state");
  const result = await oauth.completeLogin({
    code: "code-2",
    state: secondState,
    stateCookie: cookieValue(secondStart.stateCookie),
  });

  assert.equal(result.returnTo, "/dashboard");
  assert.equal(result.user.id, "user-1");
  assert.equal(result.guilds[0].id, "guild-1");
  assert.equal(result.setCookie.startsWith("guildgate.sid="), true);
  assert.equal(requests.some((request) => request.url.endsWith("/oauth2/token")), true);

  const stored = await harness.stores.credentials.get("discord", "user-1");
  assert.ok(stored);
  assert.notEqual(stored.accessTokenCiphertext, "access-1");
  assert.equal(cipher.decrypt(stored.refreshTokenCiphertext), "refresh-1");

  await assert.rejects(
    oauth.completeLogin({
      code: "code-2",
      state: secondState,
      stateCookie: cookieValue(secondStart.stateCookie),
    }),
    (error) => error?.code === "OAUTH_STATE_INVALID",
  );
});


test("Discord OAuth refresh is single-flight across concurrent callers", async () => {
  const harness = createGuildGateTestHarness();
  const cipher = createTokenCipher({
    activeKeyId: "test",
    keys: { test: randomBytes(32) },
  });
  await harness.stores.credentials.set({
    provider: "discord",
    userId: "refresh-user",
    accessTokenCiphertext: cipher.encrypt("expired-access"),
    refreshTokenCiphertext: cipher.encrypt("refresh-old"),
    scope: "identify guilds",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  let refreshes = 0;
  const oauth = createDiscordOAuth({
    kernel: harness.kernel,
    cipher,
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "http://localhost:3000/auth/discord/callback",
      async fetch(url) {
        if (new URL(String(url)).pathname.endsWith("/oauth2/token")) {
          refreshes += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Response.json({
            access_token: "access-new",
            refresh_token: "refresh-new",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "identify guilds",
          });
        }
        return new Response("not found", { status: 404 });
      },
    },
  });

  const tokens = await Promise.all(Array.from({ length: 8 }, () => oauth.getAccessToken("refresh-user")));
  assert.deepEqual(new Set(tokens), new Set(["access-new"]));
  assert.equal(refreshes, 1);
  const stored = await harness.stores.credentials.get("discord", "refresh-user");
  assert.equal(cipher.decrypt(stored.refreshTokenCiphertext), "refresh-new");
});


test("Discord OAuth production configuration rejects loopback redirect and endpoint URLs", () => {
  const harness = createGuildGateTestHarness({
    app: { environment: "production", baseUrl: "https://dashboard.example.com" },
    security: { allowedOrigins: ["https://dashboard.example.com"] },
  });
  const cipher = createTokenCipher({ activeKeyId: "test", keys: { test: randomBytes(32) } });
  const base = {
    kernel: harness.kernel,
    cipher,
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://dashboard.example.com/auth/discord/callback",
    },
  };

  assert.throws(
    () => createDiscordOAuth({ ...base, config: { ...base.config, redirectUri: "https://[::1]/callback" } }),
    (error) => error?.code === "CONFIGURATION_ERROR",
  );
  assert.throws(
    () => createDiscordOAuth({ ...base, config: { ...base.config, apiBaseUrl: "https://127.0.0.1/api" } }),
    (error) => error?.code === "CONFIGURATION_ERROR",
  );
  assert.throws(
    () => createDiscordOAuth({ ...base, config: { ...base.config, authorizationBaseUrl: "http://discord.example.com/oauth2/authorize" } }),
    (error) => error?.code === "CONFIGURATION_ERROR",
  );
});
