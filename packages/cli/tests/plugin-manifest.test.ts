import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const PLUGIN_ROOT = join(__dirname, "..", "bundled-skills");
const SKILL_DIR = join(PLUGIN_ROOT, "skillet-route");

const plugin = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
);
const marketplace = JSON.parse(
  readFileSync(join(REPO_ROOT, ".claude-plugin", "marketplace.json"), "utf8"),
);

test("the marketplace entry and the plugin manifest agree", () => {
  // `claude plugin tag` refuses a release when these drift, so catch it here.
  const entry = marketplace.plugins.find(
    (p: { name: string }) => p.name === plugin.name,
  );
  assert.ok(entry, `marketplace.json must list a plugin named "${plugin.name}"`);
  assert.equal(entry.description, plugin.description);
  assert.equal(entry.license, plugin.license);
});

test("the marketplace source resolves to the plugin manifest", () => {
  const entry = marketplace.plugins[0];
  const resolved = resolve(REPO_ROOT, entry.source);
  assert.equal(resolved, resolve(PLUGIN_ROOT));
  assert.ok(
    statSync(join(resolved, ".claude-plugin", "plugin.json")).isFile(),
    "marketplace source must point at a directory holding .claude-plugin/plugin.json",
  );
});

test("the plugin's declared skills path resolves to the router SKILL.md", () => {
  assert.deepEqual(plugin.skills, ["./skillet-route"]);
  const resolved = resolve(PLUGIN_ROOT, plugin.skills[0]);
  assert.equal(resolved, resolve(SKILL_DIR));
  assert.ok(statSync(join(resolved, "SKILL.md")).isFile());
});

test("the plugin manifest stays OUTSIDE the bundled skill directory", () => {
  // `readBundleFromDir` walks the skill dir whole and does not skip dotfiles, so
  // anything added under skillet-route/ ships into every user's ~/.skillet store
  // and out to each runtime's skills dir. A stray `.claude-plugin/plugin.json`
  // landing in ~/.claude/skills/skillet/ would also register a phantom
  // skills-dir plugin. Keep packaging metadata in the parent directory.
  const strays = readdirSync(SKILL_DIR).filter((name) => name.startsWith("."));
  assert.deepEqual(
    strays,
    [],
    `no dot-entries may live in bundled-skills/skillet-route (found: ${strays.join(", ")})`,
  );
});
