#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const includedRoots = [
  "README.md",
  "README.tr.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs",
];
const excluded = new Set([
  "docs/WRITING_STYLE.md",
  "docs/tr/yazim-kilavuzu.md",
]);

const hardPatterns = [
  ["assistant boilerplate", /\b(hope this helps|certainly[,!]|here is a polished|in today's fast-paced world|it is important to note)\b/i],
  ["decorative contrast", /\bnot only\b[^.\n]{0,160}\bbut also\b/i],
  ["provider citation artifact", /contentReference|oaicite|turn\d+(?:search|view|fetch)|attributableIndex|ppl-ai-file-upload|grok_card|:::writing/i],
  ["tracking query", /[?&]utm_(?:source|medium|campaign|term|content)=/i],
  ["unfinished placeholder", /\[(?:insert|add source|add name|placeholder)[^\]]*\]/i],
];

const watchedWords = /\b(additionally|boasts|bolstered|crucial|delve|enduring|fostering|garner|interplay|intricate|landscape|meticulous|pivotal|robust|showcase|tapestry|testament|underscore|vibrant)\b/gi;
const failures = [];
const reviews = [];

for (const target of includedRoots) {
  const full = join(root, target);
  for (const file of await filesUnder(full)) {
    const name = relative(root, file).replaceAll("\\", "/");
    if (excluded.has(name) || ![".md", ".mmd"].includes(extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const [label, pattern] of hardPatterns) {
      const match = text.match(pattern);
      if (match) failures.push({ file: name, label, value: match[0] });
    }
    const matches = [...text.matchAll(watchedWords)].map((match) => match[0]);
    if (matches.length) reviews.push({ file: name, words: [...new Set(matches.map((word) => word.toLowerCase()))] });
  }
}

for (const item of failures) console.error(`FAIL ${item.file}: ${item.label}: ${item.value}`);
for (const item of reviews) console.error(`REVIEW ${item.file}: ${item.words.join(", ")}`);

if (failures.length || reviews.length) {
  console.error(`Writing check found ${failures.length} failure(s) and ${reviews.length} review item(s).`);
  process.exitCode = 1;
} else {
  console.log("Writing check passed.");
}

async function filesUnder(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) files.push(...await filesUnder(child));
      else if (entry.isFile()) files.push(child);
    }
    return files;
  } catch (error) {
    if (error?.code === "ENOTDIR") return [path];
    throw error;
  }
}
