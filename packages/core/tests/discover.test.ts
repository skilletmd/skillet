/**
 * Cross-runtime skill discovery — first-run "wow".
 *
 * Verifies:
 *   - Skills already present across ≥2 detected runtimes are discovered and
 *     deduped by content hash (one entry, both runtimes listed).
 *   - Skills already in the kit (same hash) are flagged and excluded from
 *     `newSkills`.
 *   - Zero skills found → empty report, no throw.
 *   - importDiscoveredSkills reuses the local-import path (private `source:"local"`).
 *   - Undetected and project-scoped runtimes are not scanned.
 *
 * Isolation: HOME and SKILLET_DIR are redirected to a tmp dir via vi.hoisted
 * before @skillet/core loads, so kit state lives under TEST_ROOT.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-discover-test-${cryptoMod.randomBytes(4).toString("hex")}`,
  );
  process.env["HOME"] = root;
  process.env["SKILLET_DIR"] = pathMod.join(root, ".skillet");
  return root;
});

import {
  discoverExistingSkills,
  importDiscoveredSkills,
  runtimePhrase,
  runtimesAcross,
} from "../src/commands/discover.js";
import { readState } from "../src/kit/store.js";
import type { Adapter } from "../src/adapter.js";

const CLAUDE_DIR = join(TEST_ROOT, ".claude", "skills");
const CODEX_DIR = join(TEST_ROOT, ".agents", "skills");
const CURSOR_DIR = join(TEST_ROOT, ".cursor", "skills");

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n\nBody.\n`;
}

async function writeSkill(
  root: string,
  slug: string,
  name: string,
  description = "does a thing",
): Promise<void> {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, description));
}

function stubAdapter(opts: {
  name: string;
  detected: boolean;
  targetDir: string;
  kind?: "global" | "project";
}): Adapter {
  return {
    name: opts.name,
    ...(opts.kind ? { kind: opts.kind } : {}),
    targetDir: opts.targetDir,
    async detect() {
      return opts.detected;
    },
    targetPath: (slug: string) => join(opts.targetDir, slug, "SKILL.md"),
    targetSkillDir: (slug: string) => join(opts.targetDir, slug),
    async materialize() {
      return [];
    },
  };
}

beforeEach(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
  await mkdir(TEST_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("discoverExistingSkills", () => {
  it("dedupes an identical skill found across two runtimes", async () => {
    // Byte-identical bundle in both runtimes → same content hash → one entry.
    await writeSkill(CLAUDE_DIR, "alpha", "alpha", "shared skill");
    await writeSkill(CODEX_DIR, "alpha", "alpha", "shared skill");

    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
      stubAdapter({ name: "codex", detected: true, targetDir: CODEX_DIR }),
    ]);

    expect(report.scannedRuntimes).toEqual(["claude-code", "codex"]);
    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]!.runtimes).toEqual(["claude-code", "codex"]);
    expect(report.skills[0]!.name).toBe("alpha");
    expect(report.newSkills).toHaveLength(1);
  });

  it("counts distinct skills across runtimes and surfaces them as new", async () => {
    await writeSkill(CLAUDE_DIR, "alpha", "alpha");
    await writeSkill(CLAUDE_DIR, "beta", "beta");
    await writeSkill(CODEX_DIR, "gamma", "gamma");

    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
      stubAdapter({ name: "codex", detected: true, targetDir: CODEX_DIR }),
    ]);

    expect(report.newSkills).toHaveLength(3);
    expect(runtimesAcross(report.newSkills).sort()).toEqual(["claude-code", "codex"]);
  });

  it("excludes skillet-materialized skills from newSkills", async () => {
    await writeSkill(CLAUDE_DIR, "thiago--skillet-sync", "skillet-sync", "synced skill");

    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);

    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]!.fromSkillet).toBe(true);
    expect(report.newSkills).toEqual([]);
  });

  it("excludes skills already in the kit (hash match) from newSkills", async () => {
    await writeSkill(CLAUDE_DIR, "alpha", "alpha", "shared skill");
    await writeSkill(CLAUDE_DIR, "beta", "beta");

    // Import alpha first so its hash is in the kit.
    const first = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);
    const alpha = first.newSkills.find((s) => s.name === "alpha")!;
    await importDiscoveredSkills([alpha]);

    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);

    expect(report.skills).toHaveLength(2);
    expect(report.newSkills.map((s) => s.name)).toEqual(["beta"]);
    expect(report.skills.find((s) => s.name === "alpha")!.alreadyInKit).toBe(true);
  });

  it("returns a clean empty report when nothing is found", async () => {
    await mkdir(CLAUDE_DIR, { recursive: true });
    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);
    expect(report.scannedRuntimes).toEqual(["claude-code"]);
    expect(report.skills).toEqual([]);
    expect(report.newSkills).toEqual([]);
  });

  it("does not throw when a runtime dir does not exist", async () => {
    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);
    expect(report.skills).toEqual([]);
  });

  it("skips undetected and project-scoped runtimes", async () => {
    await writeSkill(CODEX_DIR, "gamma", "gamma");
    await writeSkill(CURSOR_DIR, "delta", "delta");

    const report = await discoverExistingSkills([
      stubAdapter({ name: "codex", detected: false, targetDir: CODEX_DIR }),
      stubAdapter({ name: "cursor", detected: true, targetDir: CURSOR_DIR, kind: "project" }),
    ]);

    expect(report.scannedRuntimes).toEqual([]);
    expect(report.skills).toEqual([]);
  });

  it("discovers skills nested one level under an owner namespace", async () => {
    await writeSkill(join(CLAUDE_DIR, "@taylor"), "festival-ops", "festival-ops");
    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
    ]);
    expect(report.newSkills.map((s) => s.name)).toEqual(["festival-ops"]);
  });
});

describe("importDiscoveredSkills", () => {
  it("imports discovered skills private-by-default and persists them to the kit", async () => {
    await writeSkill(CLAUDE_DIR, "alpha", "alpha");
    await writeSkill(CODEX_DIR, "gamma", "gamma");

    const report = await discoverExistingSkills([
      stubAdapter({ name: "claude-code", detected: true, targetDir: CLAUDE_DIR }),
      stubAdapter({ name: "codex", detected: true, targetDir: CODEX_DIR }),
    ]);

    const result = await importDiscoveredSkills(report.newSkills);
    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(2);
    for (const e of result.imported) {
      expect(e.source).toBe("local");
      expect(e.owner ?? null).toBeNull();
    }

    const state = await readState();
    expect(Object.keys(state.skills).sort()).toEqual(["alpha", "gamma"]);
  });
});

describe("runtimePhrase", () => {
  it("renders friendly runtime labels joined with +", () => {
    expect(runtimePhrase(["claude-code", "codex"])).toBe("Claude Code + Universal");
  });
  it("falls back to the raw key for unknown runtimes", () => {
    expect(runtimePhrase(["mystery"])).toBe("mystery");
  });
  it("labels opencode (a universal-baseline reader) as 'opencode'", () => {
    expect(runtimePhrase(["opencode"])).toBe("opencode");
    expect(runtimePhrase(["opencode-project"])).toBe("opencode (project)");
  });
});
