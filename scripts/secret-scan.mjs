import fs from "node:fs";
import path from "node:path";
const ignored = new Set(["node_modules", "dist", ".git"]);
const patterns = [
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/gu],
  ["npm token", /\bnpm_[A-Za-z0-9]{20,}\b/gu],
  ["Discord token", /\b(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6}\.[\w-]{20,})\b/gu],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ["webhook", /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/gu],
];
const findings=[];
for (const file of walk(".")) {
  if (/\.(?:png|jpg|jpeg|gif|zip|tgz|woff2?)$/iu.test(file)) continue;
  const source=fs.readFileSync(file,"utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex=0;
    if (pattern.test(source)) findings.push(`${file}: ${label}`);
  }
}
if (findings.length) { console.error(findings.join("\n")); process.exit(1); }
console.log("Secret scan passed for current source tree; values are never printed.");
function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap((e)=>{if(ignored.has(e.name))return[];const f=path.join(root,e.name);return e.isDirectory()?walk(f):[f];});}
