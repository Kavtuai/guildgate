import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const doctorPath = fileURLToPath(
  new URL("../bin/guildgate-doctor.mjs", import.meta.url),
);

const writingCheckPath = fileURLToPath(
  new URL("../bin/guildgate-writing-check.mjs", import.meta.url),
);

function runCli(file, args = [], cwd = process.cwd()) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
}

test("doctor help exits successfully without checking the environment", () => {
  const result = runCli(doctorPath, ["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: guildgate-doctor/);
  assert.doesNotMatch(result.stdout, /DISCORD_CLIENT_SECRET is set/);
});

test("writing check help exits successfully", () => {
  const result = runCli(writingCheckPath, ["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: guildgate-writing-check/);
});

test("writing check skips documentation paths that do not exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "guildgate-writing-check-"));

  try {
    const result = runCli(writingCheckPath, [], directory);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Writing check passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
