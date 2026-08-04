import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const testDirectory = join(root, "tests");
const files = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.mjs") && name !== "service-integration.test.mjs")
  .sort()
  .map((name) => join("tests", name));

if (!files.length) throw new Error("No coverage test files were found");

const child = spawn(process.execPath, [
  "--experimental-test-coverage",
  "--test-coverage-lines=80",
  "--test-coverage-branches=70",
  "--test-coverage-functions=70",
  "--test",
  ...files,
], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Coverage test process ended with signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
