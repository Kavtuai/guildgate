import { sha256, randomToken, type TokenCipher } from "../crypto.js";
import { errors, GuildGateError } from "../errors.js";
import type { GuildGateKernel } from "../kernel.js";
import { runWithDeadline } from "../resilience.js";
import type { OAuthCredentialStore, OAuthStateStore } from "../stores.js";
import type { SupportedLocale } from "../types.js";

export interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  locale?: string;
}

export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner: boolean;
  permissions: string;
  features?: string[];
}

interface DiscordTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  apiBaseUrl?: string;
  authorizationBaseUrl?: string;
  stateTtlMs?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  stateCookieName?: string;
}

export interface DiscordOAuthClient {
  beginLogin(input?: { returnTo?: string; locale?: SupportedLocale; prompt?: "consent" | "none" }): Promise<{
    authorizationUrl: string;
    stateCookie: string;
  }>;
  completeLogin(input: { code: string; state: string; stateCookie: string | undefined }): Promise<{
    user: DiscordOAuthUser;
    guilds: DiscordPartialGuild[];
    returnTo: string;
    sessionToken: string;
    csrfToken: string;
    setCookie: string;
    clearStateCookie: string;
  }>;
  getAccessToken(userId: string): Promise<string>;
  revoke(userId: string): Promise<void>;
}

export function createDiscordOAuth(input: {
  config: DiscordOAuthConfig;
  kernel: GuildGateKernel;
  stateStore?: OAuthStateStore;
  credentialStore?: OAuthCredentialStore;
  cipher: TokenCipher;
}): DiscordOAuthClient {
  const config = input.config;
  const fetcher = config.fetch ?? globalThis.fetch;
  const apiBase = config.apiBaseUrl ?? "https://discord.com/api/v10";
  const authBase = config.authorizationBaseUrl ?? "https://discord.com/oauth2/authorize";
  const stateStore = input.stateStore ?? input.kernel.config.stores.oauthStates;
  const credentialStore = input.credentialStore ?? input.kernel.config.stores.credentials;
  const stateCookieName = config.stateCookieName ?? (input.kernel.config.app.environment === "production" ? "__Host-guildgate.oauth" : "guildgate.oauth");
  const scopes = config.scopes ?? ["identify", "guilds"];
  if (!config.clientId.trim() || !config.clientSecret.trim()) throw errors.configuration("Discord OAuth clientId and clientSecret are required");
  if ((config.stateTtlMs ?? 10 * 60_000) < 60_000 || (config.stateTtlMs ?? 10 * 60_000) > 60 * 60_000) {
    throw errors.configuration("Discord OAuth stateTtlMs must be between 1 minute and 1 hour");
  }
  if ((config.requestTimeoutMs ?? 5_000) < 500 || (config.requestTimeoutMs ?? 5_000) > 60_000) {
    throw errors.configuration("Discord OAuth requestTimeoutMs must be between 500ms and 60 seconds");
  }
  if (!scopes.length || scopes.some((scope) => !/^[a-zA-Z0-9._-]{1,64}$/.test(scope))) throw errors.configuration("Discord OAuth scopes are invalid");
  validateStateCookieName(stateCookieName, input.kernel.config.app.environment === "production");
  validateRedirectUri(config.redirectUri, input.kernel.config.app.environment);

  return {
    async beginLogin(begin = {}) {
      const state = randomToken();
      const browserNonce = randomToken();
      const now = new Date();
      const returnTo = safeReturnTo(begin.returnTo ?? "/dashboard");
      await stateStore.put({
        stateHash: sha256(state),
        returnTo,
        locale: begin.locale ?? input.kernel.config.locale?.default ?? "en",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (config.stateTtlMs ?? 10 * 60_000)).toISOString(),
        metadata: { browserNonceHash: sha256(browserNonce) },
      });
      const url = new URL(authBase);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("state", state);
      if (begin.prompt) url.searchParams.set("prompt", begin.prompt);
      return {
        authorizationUrl: url.toString(),
        stateCookie: serializeStateCookie(stateCookieName, browserNonce, input.kernel.config.app.environment === "production", Math.floor((config.stateTtlMs ?? 10 * 60_000) / 1000)),
      };
    },

    async completeLogin(complete) {
      const record = await stateStore.consume(sha256(complete.state), new Date().toISOString());
      const expectedNonceHash = record?.metadata?.browserNonceHash;
      if (!record || typeof expectedNonceHash !== "string" || !complete.stateCookie || sha256(complete.stateCookie) !== expectedNonceHash) {
        throw errors.oauthStateInvalid();
      }
      const token = await exchangeCode(complete.code);
      const [user, guilds] = await Promise.all([
        discordGet<DiscordOAuthUser>("/users/@me", token.access_token),
        discordGet<DiscordPartialGuild[]>("/users/@me/guilds", token.access_token),
      ]);
      const now = new Date();
      await credentialStore.set({
        provider: "discord",
        userId: user.id,
        accessTokenCiphertext: input.cipher.encrypt(token.access_token),
        refreshTokenCiphertext: input.cipher.encrypt(token.refresh_token),
        scope: token.scope,
        tokenType: token.token_type,
        expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
        updatedAt: now.toISOString(),
      });
      const session = await input.kernel.createSession({
        userId: user.id,
        locale: user.locale ?? record.locale,
        metadata: {
          provider: "discord",
          username: user.username,
          globalName: user.global_name,
        },
      });
      return {
        user,
        guilds,
        returnTo: record.returnTo,
        sessionToken: session.sessionToken,
        csrfToken: session.csrfToken,
        setCookie: session.setCookie,
        clearStateCookie: clearStateCookie(stateCookieName, input.kernel.config.app.environment === "production"),
      };
    },

    async getAccessToken(userId) {
      const record = await credentialStore.get("discord", userId);
      if (!record) throw errors.authenticationRequired();
      if (new Date(record.expiresAt).getTime() - Date.now() > 60_000) {
        return input.cipher.decrypt(record.accessTokenCiphertext);
      }
      const refreshed = await refreshToken(input.cipher.decrypt(record.refreshTokenCiphertext));
      const now = new Date();
      await credentialStore.set({
        ...record,
        accessTokenCiphertext: input.cipher.encrypt(refreshed.access_token),
        refreshTokenCiphertext: input.cipher.encrypt(refreshed.refresh_token),
        scope: refreshed.scope,
        tokenType: refreshed.token_type,
        expiresAt: new Date(now.getTime() + refreshed.expires_in * 1000).toISOString(),
        updatedAt: now.toISOString(),
      });
      return refreshed.access_token;
    },

    async revoke(userId) {
      const record = await credentialStore.get("discord", userId);
      if (!record) return;
      const token = input.cipher.decrypt(record.refreshTokenCiphertext);
      const body = new URLSearchParams({ token, token_type_hint: "refresh_token" });
      await request("/oauth2/token/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(config.clientId, config.clientSecret),
        },
        body,
      }).catch(() => undefined);
      await credentialStore.delete("discord", userId);
      await input.kernel.revokeUserSessions(userId);
    },
  };

  async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
    return tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }));
  }

  async function refreshToken(token: string): Promise<DiscordTokenResponse> {
    return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }));
  }

  async function tokenRequest(body: URLSearchParams): Promise<DiscordTokenResponse> {
    const response = await request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuth(config.clientId, config.clientSecret),
      },
      body,
    });
    return parseJson<DiscordTokenResponse>(response);
  }

  async function discordGet<T>(path: string, token: string): Promise<T> {
    const response = await request(path, { headers: { authorization: `Bearer ${token}` } });
    return parseJson<T>(response);
  }

  async function request(path: string, init: RequestInit): Promise<Response> {
    const target = path.startsWith("/oauth2") ? `${apiBase}${path}` : `${apiBase}${path}`;
    return runWithDeadline({
      timeoutMs: config.requestTimeoutMs ?? 5_000,
      retry: {
        attempts: 2,
        baseDelayMs: 150,
        maximumDelayMs: 1_000,
        shouldRetry: (error) => error instanceof TypeError || (error instanceof GuildGateError && error.retryable),
        delayMs: (error) => {
          const retryAfterMs = error instanceof GuildGateError ? error.details?.retryAfterMs : undefined;
          return typeof retryAfterMs === "number" ? retryAfterMs : undefined;
        },
      },
      execute: async (signal) => {
        const response = await fetcher(target, { ...init, signal });
        if (response.status === 429) {
          const body = await response.clone().json().catch(() => ({})) as { retry_after?: number };
          throw new GuildGateError({
            code: "RATE_LIMITED",
            status: 429,
            retryable: true,
            details: { retryAfterMs: Math.ceil((body.retry_after ?? 1) * 1000) },
          });
        }
        if (!response.ok) {
          const body = (await response.text().catch(() => "")).slice(0, 2_048);
          throw errors.oauthFailed({ status: response.status, body });
        }
        return response;
      },
    });
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n\u0000]/.test(value) || value.length > 2_048) return "/dashboard";
  return value;
}

function validateRedirectUri(value: string, environment: string): void {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw errors.configuration("Discord redirect URI cannot contain credentials or a fragment");
  if (environment === "production" && url.protocol !== "https:") {
    throw errors.configuration("Discord redirect URI must use HTTPS in production");
  }
}

function serializeStateCookie(name: string, value: string, secure: boolean, maxAge: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
  ].filter(Boolean).join("; ");
}

function clearStateCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
  ].filter(Boolean).join("; ");
}

function validateStateCookieName(name: string, secure: boolean): void {
  if (!name || /[\s;,=]/.test(name)) throw errors.configuration("OAuth state cookie name is invalid");
  if (name.startsWith("__Host-") && !secure) {
    throw errors.configuration("__Host- OAuth state cookies require HTTPS");
  }
  if (name.startsWith("__Secure-") && !secure) {
    throw errors.configuration("__Secure- OAuth state cookies require HTTPS");
  }
}
