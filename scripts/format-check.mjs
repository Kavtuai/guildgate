import fs from "node:fs";
import path from "node:path";

const roots = ["src", "tests", "scripts", "bin"];
const files = roots.flatMap((root) => walk(root)).filter((file) => /\.(?:ts|mjs|json)$/u.test(file));
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("\r\n")) failures.push(`${file}: CRLF`);
  if (/[^\n\s][ \t]+$/mu.test(source)) failures.push(`${file}: trailing whitespace`);
  if (!source.endsWith("\n")) failures.push(`${file}: missing final newline`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Formatting guard passed: ${files.length} files.`);
function walk(root) {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
