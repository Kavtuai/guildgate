import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const contracts = fs.readFileSync("src/contracts.ts", "utf8");

if (pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version) {
  throw new Error("package.json and package-lock.json versions differ");
}

for (const [name, version] of [
  ["adapterContractVersion", "1.1"],
  ["actionContractVersion", "1.0"],
  ["realtimeContractVersion", "1.0"],
]) {
  if (!contracts.includes(`export const ${name} = "${version}" as const`)) {
    throw new Error(`${name} is missing or changed unexpectedly`);
  }
}

for (const readme of ["README.md", "README.tr.md"]) {
  const source = fs.readFileSync(readme, "utf8");
  if (!source.includes(`@kavtuai/guildgate@${pkg.version}`)) {
    throw new Error(`${readme} does not identify the current package version`);
  }
}

console.log(
  `Release metadata passed: ${pkg.name}@${pkg.version}; adapter 1.1; action 1.0; realtime 1.0.`,
);
