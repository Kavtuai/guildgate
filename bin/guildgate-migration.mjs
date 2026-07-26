#!/usr/bin/env node
import { buildPostgresMigration } from "../dist/postgres.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: guildgate-migration [options]",
    "",
    "Prints the PostgreSQL migration SQL for GuildGate.",
    "",
    "Options:",
    "  --prefix <name>  Table prefix. Default: guildgate",
    "  -h, --help       Show this help message.",
  ].join("\n"));
  process.exit(0);
}
const index = args.indexOf("--prefix");
const prefix = index === -1 ? "guildgate" : args[index + 1];
if (!prefix) {
  console.error("The --prefix option requires a value.");
  process.exit(2);
}
process.stdout.write(buildPostgresMigration(prefix));
