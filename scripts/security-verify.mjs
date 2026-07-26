import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const failures = [];

check(packageJson.version === "1.0.0", "package version must be 1.0.0");
check(Object.keys(packageJson.dependencies ?? {}).length === 0, "the core package must not add runtime dependencies");
check(packageJson.publishConfig?.access === "public", "publishConfig.access must stay public");

for (const [subpath, entry] of Object.entries(packageJson.exports ?? {})) {
  for (const field of ["import", "types"]) {
    const target = entry?.[field];
    if (typeof target === "string") check(await exists(join(root, target)), `missing ${field} target for ${subpath}: ${target}`);
  }
}

for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
  check(await exists(join(root, target)), `missing CLI target ${name}: ${target}`);
}

const publishWorkflow = await readFile(join(root, ".github/workflows/publish.yml"), "utf8");
check(/id-token:\s*write/.test(publishWorkflow), "publish workflow must request an OIDC token");
check(/environment:\s*npm/.test(publishWorkflow), "publish workflow must use the protected npm environment");
check(!/NODE_AUTH_TOKEN|NPM_TOKEN|npm_[A-Za-z0-9]{20,}/.test(publishWorkflow), "publish workflow must not use a long-lived npm token");
check(/Verify release tag/.test(publishWorkflow), "publish workflow must verify tag and package version");

const sourceFiles = await filesUnder(join(root, "src"));
for (const file of sourceFiles.filter((name) => name.endsWith(".ts"))) {
  const text = await readFile(file, "utf8");
  const name = relative(root, file).replaceAll("\\", "/");
  const dynamicExecution = text.split("\n").some((line) => {
    if (/new\s+Function\s*\(/.test(line)) return true;
    if (!/(?<![.\w])eval\s*\(/.test(line)) return false;
    return !/^\s*eval\s*\(.*\)\s*:\s*/.test(line);
  });
  check(!dynamicExecution, `${name} uses dynamic code execution`);
  check(!/child_process|node:vm/.test(text), `${name} imports a process or VM execution primitive`);
  check(!/TODO|FIXME|HACK|XXX/.test(text), `${name} contains an unfinished marker`);
}

const secretPattern = /(?:discord|github|npm|postgres|redis)[_-]?(?:token|secret|password)\s*[:=]\s*["'][^"']{12,}["']/i;
for (const file of await filesUnder(root)) {
  const name = relative(root, file).replaceAll("\\", "/");
  if (name.startsWith("dist/") || name.endsWith(".map") || name === "package-lock.json") continue;
  const info = await stat(file);
  if (info.size > 1_000_000) continue;
  const text = await readFile(file, "utf8").catch(() => "");
  check(!secretPattern.test(text), `${name} looks like it contains a committed credential`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`Security verification failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Security verification passed.");
console.log(`Checked ${sourceFiles.length} source file(s), ${Object.keys(packageJson.exports ?? {}).length} export path(s), release identity and credential patterns.`);

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
