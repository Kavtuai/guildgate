#!/usr/bin/env node
import { Buffer } from "node:buffer";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: guildgate-doctor [options]",
    "",
    "Checks GuildGate security, storage, analytics and production settings.",
    "",
    "Options:",
    "  --json      Print machine-readable JSON output.",
    "  -h, --help  Show this help message.",
  ].join("\n"));
  process.exit(0);
}

const isJson = args.includes("--json");
const environment = process.env.GUILDGATE_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const results = [];

check("Node.js 22 or newer", Number(process.versions.node.split(".")[0]) >= 22, process.versions.node);
checkRequired("DISCORD_CLIENT_ID");
checkRequired("DISCORD_CLIENT_SECRET");
checkRequired("DISCORD_REDIRECT_URI");
checkRequired("GUILDGATE_CSRF_SECRET");
checkRequired("GUILDGATE_AUDIT_IP_SALT");
checkRequired("GUILDGATE_TOKEN_KEY_BASE64");

checkLength("GUILDGATE_CSRF_SECRET", 32);
checkLength("GUILDGATE_AUDIT_IP_SALT", 16);
checkBase64Key("GUILDGATE_TOKEN_KEY_BASE64", 32);

if (process.env.DISCORD_REDIRECT_URI) {
  checkUrl("Discord redirect URI is valid", process.env.DISCORD_REDIRECT_URI, environment === "production");
}
if (process.env.GUILDGATE_BASE_URL) {
  checkUrl("Application base URL is valid", process.env.GUILDGATE_BASE_URL, environment === "production");
} else {
  results.push({ name: "GUILDGATE_BASE_URL", status: environment === "production" ? "fail" : "warn", detail: "not set" });
}

const origins = (process.env.GUILDGATE_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (environment === "production") {
  check("Production origin list is not empty", origins.length > 0, origins.length ? origins.join(", ") : "not set");
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      check(`Origin uses HTTPS: ${origin}`, url.protocol === "https:", url.protocol);
      check(`Origin is not localhost: ${origin}`, !["localhost", "127.0.0.1", "::1"].includes(url.hostname), url.hostname);
    } catch {
      check(`Origin is a valid URL: ${origin}`, false, "invalid URL");
    }
  }
}


if (process.env.GUILDGATE_POSTGRES_URL) {
  checkUrl("PostgreSQL URL is valid", process.env.GUILDGATE_POSTGRES_URL, false);
}
if (process.env.GUILDGATE_ANALYTICS_RETENTION_DAYS) {
  const days = Number(process.env.GUILDGATE_ANALYTICS_RETENTION_DAYS);
  check("Analytics retention is a positive number", Number.isFinite(days) && days > 0, `${days} days`);
}

if (isJson) {
  console.log(JSON.stringify({ environment, results }, null, 2));
} else {
  console.log(`GuildGate doctor (${environment})`);
  for (const result of results) {
    const mark = result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
    console.log(`${mark.padEnd(4)}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
}

process.exitCode = results.some((result) => result.status === "fail") ? 1 : 0;

function checkRequired(name) {
  check(`${name} is set`, Boolean(process.env[name]), process.env[name] ? "present" : "missing");
}

function checkLength(name, minimumBytes) {
  const value = process.env[name];
  if (!value) return;
  check(`${name} contains at least ${minimumBytes} bytes`, Buffer.byteLength(value) >= minimumBytes, `${Buffer.byteLength(value)} bytes`);
}

function checkBase64Key(name, expectedBytes) {
  const value = process.env[name];
  if (!value) return;
  try {
    const decoded = Buffer.from(value, "base64");
    check(`${name} decodes to ${expectedBytes} bytes`, decoded.length === expectedBytes, `${decoded.length} bytes`);
  } catch {
    check(`${name} is valid base64`, false, "decode failed");
  }
}

function checkUrl(name, value, requireHttps) {
  try {
    const url = new URL(value);
    check(name, !requireHttps || url.protocol === "https:", `${url.protocol}//${url.host}`);
  } catch {
    check(name, false, "invalid URL");
  }
}

function check(name, passed, detail) {
  results.push({ name, status: passed ? "pass" : "fail", detail });
}
