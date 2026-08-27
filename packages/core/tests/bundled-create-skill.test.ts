import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEvalFixture } from "@skillet/protocol";
import { readBundleFromDir } from "../src/bundle/read.js";
import {
  BUNDLED_CREATE_SLUG,
  ensureBundledCreateSkill,
} from "../src/commands/bundled-route-skill.js";
import { listRouteManifest } from "../src/commands/route.js";
import { readState, skillContentPath } from "../src/kit/store.js";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-bundled-create-test-${cryptoMod.randomBytes(4).toString("hex")}`,
  );
  process.env["HOME"] = root;
  process.env["SKILLET_DIR"] = pathMod.join(root, ".skillet");
  return root;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CREATE_DIR = join(HERE, "../../cli/bundled-skills/skillet-create");
const ROUTE_DIR = join(HERE, "../../cli/bundled-skills/skillet-route");

describe("bundled create playbook asset", () => {
  it("passes bundle validation and carries the phases the router promises", async () => {
    const bundle = await readBundleFromDir(CREATE_DIR);
    expect(bundle.has("SKILL.md")).toBe(true);
    const body = Buffer.from(bundle.get("SKILL.md")!).toString("utf8");
    expect(body).toMatch(/user-invocable:\s*true/);
    // The two commands the playbook must actually drive.
    expect(body).toMatch(/skillet import/);
    expect(body).toMatch(/skillet eval/);
  });

  it("keeps private the default and public an explicit yes", async () => {
    const body = await readFile(join(CREATE_DIR, "SKILL.md"), "utf8");
    // `skillet import` backs up privately; the ONLY public path is `--public`,
    // and the playbook must never pre-approve it with `--yes`.
    expect(body).toMatch(/skillet upload --skill <slug> --public/);
    expect(body).not.toMatch(/--public\s+--yes/);
    expect(body).toMatch(/explicit yes/i);
  });

  it("only cites commands that exist without SKILLET_LEGACY_CLI", async () => {
    // The playbook is instructions an agent executes verbatim. A management-tier
    // verb makes commander print help, which the agent reads as success while
    // nothing happened. `publish` is the one that bit: it is legacy-only, so the
    // public flip must go through `upload --public`.
    const body = await readFile(join(CREATE_DIR, "SKILL.md"), "utf8");
    const cited = new Set(
      [...body.matchAll(/^\s*skillet ([a-z-]+)/gm)].map((m) => m[1]!),
    );
    const deviceTier = new Set([
      "whoami",
      "connect",
      "create",
      "import",
      "eval",
      "upload",
      "sync",
      "add",
      "search",
      "list",
      "init",
    ]);
    for (const verb of cited) {
      expect(deviceTier.has(verb), `\`skillet ${verb}\` must be device-tier`).toBe(true);
    }
  });

  it("pairs before importing, because import gates on it", async () => {
    // import-cmd.ts calls requirePaired() ahead of every branch, so an unpaired
    // machine writes nothing. The playbook must check first, not recover after.
    const body = await readFile(join(CREATE_DIR, "SKILL.md"), "utf8");
    // Compare RUNNABLE occurrences (line-start, inside a fence), not prose
    // mentions — the paragraph explaining the gate names `import` first.
    const runAt = (cmd: string) => body.search(new RegExp(`^${cmd}\\b`, "m"));
    expect(runAt("skillet whoami")).toBeGreaterThan(-1);
    expect(runAt("skillet import")).toBeGreaterThan(-1);
    expect(runAt("skillet whoami")).toBeLessThan(runAt("skillet import"));
  });

  it("documents an eval fixture the real parser accepts", async () => {
    const body = await readFile(join(CREATE_DIR, "SKILL.md"), "utf8");
    const block = body.match(/```json\n([\s\S]*?)```/);
    expect(block).not.toBeNull();
    // A sample the agent copies must not be one the runner rejects.
    expect(() => parseEvalFixture(JSON.parse(block![1]!))).not.toThrow();
  });
});

describe("router dispatch to the playbook", () => {
  it("the route skill sends a leading `create` token to @skillet/create", async () => {
    const body = await readFile(join(ROUTE_DIR, "SKILL.md"), "utf8");
    expect(body).toMatch(/`create` is a verb, not a handle/);
    expect(body).toMatch(/@skillet\/create/);
    // The store path is the only way in, since the manifest excludes it.
    expect(body).toMatch(/skills\/@skillet\/create\/SKILL\.md/);
  });
});

describe("ensureBundledCreateSkill", () => {
  beforeEach(async () => {
    await mkdir(join(TEST_ROOT, ".skillet", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("installs @skillet/create into the kit", async () => {
    expect(await ensureBundledCreateSkill(CREATE_DIR)).toBe("installed");
    const state = await readState();
    expect(state.skills[BUNDLED_CREATE_SLUG]).toBeDefined();
    await readFile(skillContentPath(BUNDLED_CREATE_SLUG), "utf8");
  });

  it("is unchanged on a second run with the same bundle", async () => {
    await ensureBundledCreateSkill(CREATE_DIR);
    expect(await ensureBundledCreateSkill(CREATE_DIR)).toBe("unchanged");
  });

  it("falls back to inlined SKILL.md when the bundle dir is absent (sidecar)", async () => {
    const inline = await readFile(join(CREATE_DIR, "SKILL.md"), "utf8");
    expect(await ensureBundledCreateSkill("/no/such/dir", inline)).toBe("installed");
    const body = await readFile(skillContentPath(BUNDLED_CREATE_SLUG), "utf8");
    expect(body).toMatch(/skillet import/);
  });

  it("never becomes a routing candidate", async () => {
    // `/skillet create` reaches the playbook through the router's dispatch
    // block. If it also sat in the manifest, an ordinary `/skillet <task>` could
    // route TO the create flow instead of doing the user's work.
    await ensureBundledCreateSkill(CREATE_DIR);
    const manifest = await listRouteManifest();
    expect(manifest.map((e) => e.slug)).not.toContain(BUNDLED_CREATE_SLUG);
  });
});
