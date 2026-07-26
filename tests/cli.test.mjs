import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(file, args = [], cwd = process.cwd()) {
  return spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8" });
}

test("CLI help commands work from installed-style directories", () => {
  const doctor = run("bin/guildgate-doctor.mjs", ["--help"]);
  const writing = run("bin/guildgate-writing-check.mjs", ["--help"]);
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /Usage: guildgate-doctor/);
  assert.equal(writing.status, 0);
  assert.match(writing.stdout, /Usage: guildgate-writing-check/);
});

test("writing checker tolerates absent documentation roots", () => {
  const directory = mkdtempSync(join(tmpdir(), "guildgate-writing-"));
  try {
    const result = run(new URL("../bin/guildgate-writing-check.mjs", import.meta.url).pathname.replace(/^\/(.:)/, "$1"), [], directory);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
