import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; run package inspection through npm.");
}

function runNpm(args, options = {}) {
  return execFileSync(process.execPath, [npmCli, ...args], options);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "guildgate-pack-"));

try {
  const raw = runNpm(
    ["pack", "--json", "--pack-destination", temp],
    {encoding: "utf8"},
  );
  const info = JSON.parse(raw)[0];
  const names = info.files.map((entry) => entry.path.replaceAll("\\", "/"));
  const blocked = [
    /(^|\/)\.env(?:\.|$)/u,
    /^\.github\//u,
    /^src\//u,
    /^tests\//u,
    /\.map$/u,
    /SECURITY_AUDIT\.md$/u,
    /TEST_REPORT\.md$/u,
    /LOAD_TEST_REPORT\.json$/u,
    /EXTERNAL_REVIEW_GUIDE\.md$/u,
    /MANIFEST\.txt$/u,
    /CHECKSUMS\.sha256$/u,
  ];
  const bad = names.filter((name) => blocked.some((rule) => rule.test(name)));
  if (bad.length) {
    throw new Error(`Blocked package entries:\n${bad.join("\n")}`);
  }

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const exported of Object.values(pkg.exports)) {
    for (const key of ["types", "import"]) {
      const expected = exported[key].replace(/^\.\//u, "");
      if (!names.includes(expected)) {
        throw new Error(`Missing exported file: ${exported[key]}`);
      }
    }
  }

  for (const readme of ["README.md", "README.tr.md"]) {
    const text = fs.readFileSync(readme, "utf8");
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].split("#", 1)[0];
      if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
        continue;
      }
      if (!names.includes(target.replace(/^\.\//u, ""))) {
        throw new Error(`${readme} links to a file excluded from the package: ${target}`);
      }
    }
  }

  const consumer = path.join(temp, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({name: "guildgate-consumer-check", private: true, type: "module"}),
  );
  const tarball = path.join(temp, info.filename);
  runNpm(
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    {cwd: consumer, stdio: "pipe"},
  );

  const installedRoot = path.join(consumer, "node_modules", "@kavtuai", "guildgate");
  for (const [subpath, exported] of Object.entries(pkg.exports)) {
    const modulePath = path.join(installedRoot, exported.import.replace(/^\.\//u, ""));
    await import(`${pathToFileURL(modulePath).href}?subpath=${encodeURIComponent(subpath)}`);
  }

  for (const executable of Object.values(pkg.bin)) {
    execFileSync(process.execPath, [path.join(installedRoot, executable), "--help"], {
      cwd: consumer,
      stdio: "pipe",
    });
  }

  console.log(
    `Package inspection passed: ${names.length} files, ${info.unpackedSize} unpacked bytes, ` +
    `${Object.keys(pkg.exports).length} exports and ${Object.keys(pkg.bin).length} CLI commands verified from the packed tarball.`,
  );
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
