#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Optional dist override (argv[2]). The CLI's test files run in parallel and
// several of them spawn dist/cli.cjs, so the tests that assert this script
// FAILS on a damaged artifact verify a private copy instead of corrupting the
// shared bundle out from under their siblings. No argument = the real dist,
// which is what prepublishOnly uses.
const dist = process.argv[2] ?? join(here, "..", "dist");
const bundledSkill = join(dist, "bundled-skills", "skillet-route", "SKILL.md");
const bundledCreateSkill = join(dist, "bundled-skills", "skillet-create", "SKILL.md");
const cliCjs = join(dist, "cli.cjs");

function fail(message) {
  console.error(`verify-publish-artifacts: ${message}`);
  process.exit(1);
}

if (!existsSync(bundledSkill)) {
  fail(`missing bundled route skill at ${bundledSkill}`);
}

if (!existsSync(bundledCreateSkill)) {
  fail(`missing bundled create playbook at ${bundledCreateSkill}`);
}

if (!existsSync(cliCjs)) {
  fail(`missing bundled CLI at ${cliCjs}`);
}

const body = readFileSync(cliCjs, "utf8");
if (!/\.command\(["']route["']\)/.test(body)) {
  fail("cli.cjs does not register the route command");
}
if (!/\.command\(["']begin["']\)/.test(body)) {
  fail("cli.cjs does not register the route begin subcommand");
}
if (!/\.command\(["']hook["']\)/.test(body)) {
  fail("cli.cjs does not register the route hook subcommand");
}

console.log("Publish artifacts OK");
