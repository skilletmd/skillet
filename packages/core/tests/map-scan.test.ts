/**
 * The read-only map scan (plan U3, KTD2; R4 R5 R6 R7 R9 R15; AE4).
 *
 * Every fixture is a home built inside a temp dir: HOME and SKILLET_DIR are
 * redirected via vi.hoisted before core loads, and each test starts from an
 * empty home. Adapters are stubs pointing into that home, so nothing here can
 * read a real skills folder, config, or plugin cache.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalContentHash } from "@skillet/protocol";
import { symlinksAvailable } from "./symlink-support.js";

const HOME = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-map-scan") as string;
});

import { scanMap, type MapScanEntry } from "../src/map/scan.js";
import { recordTccGrant, resetTccInvocation, setTccInvocation } from "../src/util/tcc-access.js";
import type { Adapter } from "../src/adapter.js";

const CLAUDE = join(HOME, ".claude", "skills");
const AGENTS = join(HOME, ".agents", "skills");
const CODEX_LEGACY = join(HOME, ".codex", "skills");

function stub(
  name: string,
  targetDir: string,
  opts: { kind?: "project"; detect?: () => boolean } = {},
): Adapter {
  return {
    name,
    ...(opts.kind ? { kind: opts.kind } : {}),
    targetDir,
    async detect() {
      return opts.detect ? opts.detect() : existsSync(dirname(targetDir));
    },
    targetPath: (slug: string) => join(targetDir, slug, "SKILL.md"),
    targetSkillDir: (slug: string) => join(targetDir, slug),
    async materialize() {
      return [];
    },
  };
}

/** Every path per tool, from where the entry was found. */
function pathsOf(entry: MapScanEntry): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const location of entry.locations) for (const tool of location.tools) (paths[tool] ??= []).push(location.path);
  return paths;
}

// Same detection rules as the real adapters, pointed at the fixture home.
const claude = () => stub("claude-code", CLAUDE);
const codex = () =>
  stub("codex", AGENTS, {
    detect: () => existsSync(join(HOME, ".agents")) || existsSync(join(HOME, ".codex")),
  });

function skillMd(name: string, description = `${name} helper`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody for ${name}.\n`;
}

async function writeSkill(
  dir: string,
  name: string,
  extra: Record<string, string | Buffer> = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name));
  for (const [rel, content] of Object.entries(extra)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

const INSTALLED = join(HOME, ".claude", "plugins", "installed_plugins.json");

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
});

afterEach(() => {
  delete process.env["SKILLET_TCC_POLICY"];
  resetTccInvocation();
  vi.unstubAllGlobals();
});

describe("scanMap: counting a skill once", () => {
  it("the same skill in ~/.claude/skills and ~/.agents/skills is one entry with two tools and two paths", async () => {
    await writeSkill(join(CLAUDE, "pdf"), "pdf");
    await writeSkill(join(AGENTS, "pdf"), "pdf");

    const result = await scanMap({ adapters: [codex(), claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry!.tools).toEqual(["codex", "claude-code"]);
    expect(pathsOf(entry!)).toEqual({
      codex: [join(AGENTS, "pdf")],
      "claude-code": [join(CLAUDE, "pdf")],
    });
    expect(entry!.copies).toEqual({ codex: 1, "claude-code": 1 });
    expect(entry!).toMatchObject({
      name: "pdf",
      description: "pdf helper",
      source: "local",
      owner: null,
      jobId: "business.docs-and-pdfs",
      flags: { cantBackUp: [] },
    });
    expect(result.tools).toEqual(["codex", "claude-code"]);
  });

  it("agent-browser and _local--agent-browser with the same contents in one tool are one entry with two copies", async () => {
    await writeSkill(join(CLAUDE, "agent-browser"), "agent-browser");
    await writeSkill(join(CLAUDE, "_local--agent-browser"), "agent-browser");

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry!.copies).toEqual({ "claude-code": 2 });
    expect(pathsOf(entry!)["claude-code"]).toEqual([
      join(CLAUDE, "_local--agent-browser"),
      join(CLAUDE, "agent-browser"),
    ]);
    expect(entry!.locations.map((l) => l.source)).toEqual(["skillet-imported", "local"]);
    expect(entry!.locations[0]!.skillet).toEqual({ maker: null, slug: "agent-browser" });
    // Already in Skillet's kit store, so it isn't backed up a second time.
    expect(entry!.source).toBe("skillet-imported");
    expect(entry!.jobId).toBe("tools.browser");
  });

  it("a skill with a .DS_Store gets the same key as the same skill without one", async () => {
    await writeSkill(join(CLAUDE, "pdf"), "pdf", {
      ".DS_Store": Buffer.from([0, 1, 2, 3]),
      "references/.DS_Store": "finder",
      "SKILL.md.skillet-backup": "an older SKILL.md",
    });
    await writeSkill(join(AGENTS, "pdf"), "pdf");

    const result = await scanMap({ adapters: [codex(), claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.tools).toEqual(["codex", "claude-code"]);
    expect(result.entries[0]!.key).toBe(
      canonicalContentHash(new Map([["SKILL.md", readFileSync(join(AGENTS, "pdf", "SKILL.md"))]])),
    );
    expect(result.entries[0]!.flags).toEqual({ cantBackUp: [], cantMerge: [] });
  });

  it("tells the person's own published skills from other makers' by handle", async () => {
    await writeSkill(join(CLAUDE, "test-handle--festival-ops"), "festival-ops");
    await writeSkill(join(CLAUDE, "alice--show-notes"), "show-notes");

    const result = await scanMap({ adapters: [claude()], handle: "test-handle" });

    const bySource = Object.fromEntries(result.entries.map((e) => [e.name, e.source]));
    expect(bySource).toEqual({ "festival-ops": "skillet-own", "show-notes": "skillet-added" });
    const added = result.entries.find((e) => e.name === "show-notes");
    expect(added!.locations[0]!.skillet).toEqual({ maker: "alice", slug: "show-notes" });
  });
});

describe("scanMap: links", () => {
  it.skipIf(!symlinksAvailable)("follows a symlinked skill folder and lists it", async () => {
    const target = join(HOME, "src", "my-skill");
    await writeSkill(target, "my-skill");
    await mkdir(CLAUDE, { recursive: true });
    await symlink(target, join(CLAUDE, "my-skill"), "dir");

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(pathsOf(entry!)["claude-code"]).toEqual([join(CLAUDE, "my-skill")]);
    expect(entry!.locations[0]!.linkTarget).toBe(realpathSync(target));
    expect(entry!.flags).toEqual({ cantBackUp: [], cantMerge: [] });
  });

  it.skipIf(!symlinksAvailable)(
    "a link into a protected folder it can't read without a prompt goes to the unreadable list, and the scan goes on",
    async () => {
      // The policy is macOS-only; force it on so the fixture Documents counts on any box.
      process.env["SKILLET_TCC_POLICY"] = "force";
      const target = join(HOME, "Documents", "skills", "secret-skill");
      await writeSkill(target, "secret-skill");
      await writeSkill(join(CLAUDE, "pdf"), "pdf");
      await symlink(target, join(CLAUDE, "secret-skill"), "dir");

      const result = await scanMap({ adapters: [claude()], handle: null });

      expect(result.entries.map((e) => e.name)).toEqual(["pdf"]);
      expect(result.unreadable).toEqual([
        {
          path: join(CLAUDE, "secret-skill"),
          reason: "protected-folder",
          tools: ["claude-code"],
          detail: realpathSync(target),
        },
      ]);
    },
  );

  it.skipIf(!symlinksAvailable)(
    "reads a protected folder this terminal already has access to",
    async () => {
      process.env["SKILLET_TCC_POLICY"] = "force";
      setTccInvocation({ initiation: "user", context: "cli" });
      const target = join(HOME, "Documents", "skills", "secret-skill");
      await writeSkill(target, "secret-skill");
      await mkdir(CLAUDE, { recursive: true });
      await symlink(target, join(CLAUDE, "secret-skill"), "dir");
      recordTccGrant(join(HOME, "Documents"), "cli");

      const result = await scanMap({ adapters: [claude()], handle: null });

      expect(result.entries.map((e) => e.name)).toEqual(["secret-skill"]);
      expect(result.unreadable).toEqual([]);
    },
  );

  it.skipIf(!symlinksAvailable)(
    "a skills folder linked to another is read once: each skill has one location, loaded by both tools",
    async () => {
      // ~/.claude/skills -> ~/.agents/skills: one shared folder.
      await writeSkill(join(AGENTS, "pdf"), "pdf");
      await writeSkill(join(AGENTS, "synced", "acme", "brand-voice"), "brand-voice");
      await mkdir(join(HOME, ".claude"), { recursive: true });
      await symlink(AGENTS, CLAUDE, "dir");

      const result = await scanMap({ adapters: [codex(), claude()], handle: null });

      expect(result.entries.map((e) => e.name)).toEqual(["brand-voice", "pdf"]);
      const pdf = result.entries.find((e) => e.name === "pdf")!;
      expect(pdf.locations.map((l) => [l.path, l.tools])).toEqual([[join(AGENTS, "pdf"), ["codex", "claude-code"]]]);
      expect(pdf.copies).toEqual({ codex: 1, "claude-code": 1 });
      // Claude Code loads the folder, so its synced/ is still Claude Code's organization sync.
      const synced = result.entries.find((e) => e.name === "brand-voice")!;
      expect(synced.locations.map((l) => [l.path, l.source])).toEqual([
        [join(AGENTS, "synced", "acme", "brand-voice"), "synced"],
      ]);
      expect(synced.owner).toEqual({ kind: "organization", name: "acme" });
      expect(result.folders).toEqual([{ path: AGENTS, tools: ["codex", "claude-code"] }]);
      expect(result.tools).toEqual(["codex", "claude-code"]);
    },
  );

  it.skipIf(!symlinksAvailable)("~/.codex/skills linked to ~/.agents/skills doesn't count Codex's copy twice", async () => {
    await writeSkill(join(AGENTS, "pdf"), "pdf");
    await mkdir(join(HOME, ".codex"), { recursive: true });
    await symlink(AGENTS, CODEX_LEGACY, "dir");

    const result = await scanMap({ adapters: [codex(), claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.locations.map((l) => l.path)).toEqual([join(AGENTS, "pdf")]);
    expect(result.entries[0]!.copies).toEqual({ codex: 1 });
    expect(result.folders).toEqual([{ path: AGENTS, tools: ["codex"] }]);
  });

  it.skipIf(!symlinksAvailable)("a link to nowhere is named as broken, and the scan goes on", async () => {
    await writeSkill(join(CLAUDE, "pdf"), "pdf");
    await symlink(join(HOME, "nowhere"), join(CLAUDE, "dangling"), "dir");

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries.map((e) => e.name)).toEqual(["pdf"]);
    expect(result.unreadable).toEqual([
      { path: join(CLAUDE, "dangling"), reason: "broken-link", tools: ["claude-code"] },
    ]);
  });

  it.skipIf(!symlinksAvailable)(
    "a skill whose folder holds 16 links is listed, can't back up, and is keyed by its regular files",
    async () => {
      const shared = join(HOME, "shared");
      await mkdir(shared, { recursive: true });
      const dir = join(CLAUDE, "linky");
      await writeSkill(dir, "linky", { "references/notes.md": "notes\n" });
      await mkdir(join(dir, "linked"), { recursive: true });
      for (let i = 0; i < 16; i++) {
        await writeFile(join(shared, `part-${i}.md`), `part ${i}\n`);
        await symlink(join(shared, `part-${i}.md`), join(dir, "linked", `part-${i}.md`), "file");
      }

      const result = await scanMap({ adapters: [claude()], handle: null });

      expect(result.entries).toHaveLength(1);
      const [entry] = result.entries;
      expect(entry!.name).toBe("linky");
      expect(entry!.flags.cantBackUp).toEqual(["links-outside"]);
      expect(entry!.flags.cantMerge).toEqual(["links-outside", "extra-files"]);
      expect(entry!.key).toBe(
        canonicalContentHash(
          new Map([
            ["SKILL.md", readFileSync(join(dir, "SKILL.md"))],
            ["references/notes.md", readFileSync(join(dir, "references", "notes.md"))],
          ]),
        ),
      );
    },
  );
});

describe("scanMap: who owns a folder", () => {
  it("a skill under ~/.claude/skills/synced/<org>/ is listed as synced from that organization", async () => {
    await writeSkill(join(CLAUDE, "synced", "acme", "brand-voice"), "brand-voice");

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      name: "brand-voice",
      source: "synced",
      owner: { kind: "organization", name: "acme" },
      tools: ["claude-code"],
    });
  });

  it("a skill under ~/.claude/skills/<app>/skills/ is listed as app-managed under the app", async () => {
    await writeSkill(join(CLAUDE, "someapp", "skills", "helper"), "helper");

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      name: "helper",
      source: "app",
      owner: { kind: "app", name: "someapp", folder: join(CLAUDE, "someapp") },
    });
    expect(pathsOf(result.entries[0]!)).toEqual({ "claude-code": [join(CLAUDE, "someapp", "skills", "helper")] });
  });

  it("leaves out .trash, ~/.codex/skills/.system and Skillet's router skill", async () => {
    await writeSkill(join(CLAUDE, ".trash", "old-skill"), "old-skill");
    await writeSkill(join(CODEX_LEGACY, ".system", "system-skill"), "system-skill");
    await writeSkill(join(CLAUDE, "skillet"), "skillet");
    await writeSkill(join(AGENTS, "skillet"), "skillet");
    await writeSkill(join(CLAUDE, "pdf"), "pdf");

    const result = await scanMap({ adapters: [codex(), claude()], handle: null });

    expect(result.entries.map((e) => e.name)).toEqual(["pdf"]);
    expect(result.unreadable).toEqual([]);
  });

  it("reads only detected tools' folders, never a project-kind adapter's, and lets opencode and Cursor share ~/.agents/skills", async () => {
    await writeSkill(join(AGENTS, "pdf"), "pdf");
    const windsurfDir = join(HOME, ".codeium", "windsurf", "skills");
    await writeSkill(join(windsurfDir, "surf-skill"), "surf-skill");
    await mkdir(join(HOME, ".cursor"), { recursive: true });
    await mkdir(join(HOME, ".config", "opencode"), { recursive: true });

    const result = await scanMap({
      adapters: [
        codex(),
        stub("opencode", AGENTS, { detect: () => existsSync(join(HOME, ".config", "opencode")) }),
        stub("cursor", ".cursor/rules", {
          kind: "project",
          detect: () => existsSync(join(HOME, ".cursor")),
        }),
        stub("windsurf", windsurfDir, { detect: () => false }),
      ],
      handle: null,
    });

    expect(result.entries.map((e) => e.name)).toEqual(["pdf"]);
    expect(result.entries[0]!.tools).toEqual(["codex", "opencode", "cursor"]);
    expect(result.entries[0]!.copies).toEqual({ codex: 1, opencode: 1, cursor: 1 });
    expect(result.tools).toEqual(["codex", "opencode", "cursor"]);
    expect(result.folders).toEqual([{ path: AGENTS, tools: ["codex", "opencode", "cursor"] }]);
  });
});

describe("scanMap: plugins", () => {
  it("an enabled Claude Code plugin with two skills gives two plugin entries; a turned-off plugin's entries say it's off", async () => {
    const market = join(HOME, ".claude", "plugins", "cache", "market");
    const alpha = join(market, "alpha", "1.0.0");
    const beta = join(market, "beta", "2.0.0");
    await writeSkill(join(alpha, "skills", "one"), "one");
    await writeSkill(join(alpha, "skills", "two"), "two");
    await writeSkill(join(beta, "skills", "three"), "three");
    await writeJson(INSTALLED, {
      version: 2,
      plugins: {
        "alpha@market": [{ scope: "user", installPath: alpha, version: "1.0.0" }],
        "beta@market": [{ scope: "user", installPath: beta, version: "2.0.0" }],
      },
    });
    await writeJson(join(HOME, ".claude", "settings.json"), {
      enabledPlugins: { "alpha@market": true, "beta@market": false },
    });

    const result = await scanMap({ adapters: [claude()], handle: null });

    const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(["one", "three", "two"]);
    for (const name of ["one", "two"]) {
      expect(byName[name]).toMatchObject({
        source: "plugin",
        tools: ["claude-code"],
        owner: { kind: "plugin", name: "alpha", marketplace: "market", enabled: true },
      });
    }
    expect(byName["three"]!.owner).toEqual({
      kind: "plugin",
      name: "beta",
      marketplace: "market",
      enabled: false,
    });
    expect(result.folders).toContainEqual({ path: join(alpha, "skills"), tools: ["claude-code"] });
    expect(result.tools).toEqual(["claude-code"]);
  });

  it("a project-scope plugin lands in the unreadable list", async () => {
    const gamma = join(HOME, ".claude", "plugins", "cache", "market", "gamma", "1.0.0");
    await writeSkill(join(gamma, "skills", "proj-skill"), "proj-skill");
    await writeJson(INSTALLED, {
      version: 2,
      plugins: {
        "gamma@market": [
          { scope: "project", projectPath: join(HOME, "work", "app"), installPath: gamma },
        ],
      },
    });

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect(result.entries).toEqual([]);
    expect(result.unreadable).toEqual([
      {
        path: join(HOME, "work", "app"),
        reason: "project-plugin",
        tools: ["claude-code"],
        plugin: "gamma@market",
        detail: "project",
      },
    ]);
  });

  it("a Codex plugin with two version folders contributes only the newest one's skills", async () => {
    const plugin = join(HOME, ".codex", "plugins", "cache", "mkt", "delta");
    await writeSkill(join(plugin, "1.9.0", "skills", "old-skill"), "old-skill");
    await writeSkill(join(plugin, "1.10.0", "skills", "new-skill"), "new-skill");
    await writeFile(join(HOME, ".codex", "config.toml"), '[plugins."delta@mkt"]\nenabled = true\n');

    const result = await scanMap({ adapters: [codex()], handle: null });

    expect(result.entries.map((e) => e.name)).toEqual(["new-skill"]);
    expect(result.entries[0]).toMatchObject({
      source: "plugin",
      tools: ["codex"],
      owner: { kind: "plugin", name: "delta", marketplace: "mkt", enabled: true },
    });
    expect(pathsOf(result.entries[0]!)).toEqual({ codex: [join(plugin, "1.10.0", "skills", "new-skill")] });
  });
});

describe("scanMap: flags and jobs", () => {
  it("names what stops a skill backing up or merging", async () => {
    await writeSkill(join(CLAUDE, "plain"), "plain");
    await writeSkill(join(CLAUDE, "with-refs"), "with-refs", { "references/a.md": "a\n" });
    await writeSkill(join(CLAUDE, "with-git"), "with-git", { ".git/HEAD": "ref: refs/heads/main\n" });
    await writeSkill(join(CLAUDE, "huge"), "huge", { "model.bin": Buffer.alloc(25 * 1024 * 1024 + 1) });
    await mkdir(join(CLAUDE, "wordy"), { recursive: true });
    await writeFile(join(CLAUDE, "wordy", "SKILL.md"), skillMd("wordy") + "x".repeat(1024 * 1024));

    const result = await scanMap({ adapters: [claude()], handle: null });

    const flags = Object.fromEntries(result.entries.map((e) => [e.name, e.flags]));
    expect(flags).toEqual({
      plain: { cantBackUp: [], cantMerge: [] },
      "with-refs": { cantBackUp: [], cantMerge: ["extra-files"] },
      "with-git": { cantBackUp: ["git-folder"], cantMerge: [] },
      huge: { cantBackUp: ["over-25-mb"], cantMerge: ["extra-files"] },
      wordy: { cantBackUp: ["instructions-over-1-mb"], cantMerge: [] },
    });
  });

  it("sorts each skill into a job, or leaves it unsorted when nothing says", async () => {
    await writeSkill(join(CLAUDE, "agent-browser"), "agent-browser");
    // Known by its folder name even under Skillet's prefix.
    await writeSkill(join(CLAUDE, "alice--pdf"), "Document helper");
    await mkdir(join(CLAUDE, "mystery"), { recursive: true });
    await writeFile(
      join(CLAUDE, "mystery", "SKILL.md"),
      "---\nname: mystery\ndescription: qzx vlorp\n---\n\nwibble\n",
    );

    const result = await scanMap({ adapters: [claude()], handle: null });

    const jobs = Object.fromEntries(result.entries.map((e) => [e.name, e.jobId]));
    expect(jobs).toEqual({
      "agent-browser": "tools.browser",
      "Document helper": "business.docs-and-pdfs",
      mystery: null,
    });
  });
});

describe("scanMap: front matter", () => {
  it("never runs front matter written as code, and falls back to the folder name", async () => {
    const flag = "__skilletMapScanRanFrontMatter";
    await mkdir(join(CLAUDE, "sneaky"), { recursive: true });
    await writeFile(
      join(CLAUDE, "sneaky", "SKILL.md"),
      `---js\n{ name: (globalThis.${flag} = true, "evil"), description: "ran" }\n---\n\nBody.\n`,
    );

    const result = await scanMap({ adapters: [claude()], handle: null });

    expect((globalThis as Record<string, unknown>)[flag]).toBeUndefined();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ name: "sneaky", description: "" });
  });
});

describe("scanMap: an empty home", () => {
  it("gives zero entries and no error", async () => {
    const result = await scanMap({
      adapters: [
        codex(),
        claude(),
        stub("cursor", ".cursor/rules", { kind: "project", detect: () => existsSync(join(HOME, ".cursor")) }),
      ],
      handle: null,
    });

    expect(result.entries).toEqual([]);
    expect(result.unreadable).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.folders).toEqual([]);
    expect(Number.isNaN(Date.parse(result.scannedAt))).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/** Every path under `root` (links not followed) with its type, size, mtime and content hash. */
function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = { ".": `dir ${lstatSync(root).mtimeMs}` };
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = relative(root, abs);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        out[rel] = `link ${readlinkSync(abs)} ${st.mtimeMs}`;
      } else if (st.isDirectory()) {
        out[rel] = `dir ${st.mtimeMs} ${st.mode}`;
        walk(abs);
      } else {
        const sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
        out[rel] = `file ${st.size} ${st.mtimeMs} ${st.mode} ${sha}`;
      }
    }
  };
  walk(root);
  return out;
}

describe("scanMap: read-only (AE4)", () => {
  it.skipIf(!symlinksAvailable)(
    "leaves every file's contents, its modification time and the folder tree unchanged, and makes no network call",
    async () => {
      // One of everything the scan reads.
      await writeSkill(join(CLAUDE, "agent-browser"), "agent-browser", { ".DS_Store": "finder" });
      await writeSkill(join(CLAUDE, "_local--agent-browser"), "agent-browser");
      await writeSkill(join(CLAUDE, "test-handle--festival-ops"), "festival-ops");
      await writeSkill(join(CLAUDE, ".trash", "old"), "old");
      await writeSkill(join(CLAUDE, "synced", "acme", "brand-voice"), "brand-voice");
      await writeSkill(join(CLAUDE, "someapp", "skills", "helper"), "helper");
      await writeSkill(join(CLAUDE, "with-git"), "with-git", { ".git/HEAD": "ref: refs/heads/main\n" });
      await writeSkill(join(HOME, "src", "linked"), "linked");
      await symlink(join(HOME, "src", "linked"), join(CLAUDE, "linked"), "dir");
      await writeSkill(join(CLAUDE, "linky"), "linky");
      await symlink(join(HOME, "src", "linked", "SKILL.md"), join(CLAUDE, "linky", "borrowed.md"), "file");
      await symlink(join(HOME, "nowhere"), join(CLAUDE, "dangling"), "dir");
      await writeSkill(join(AGENTS, "pdf"), "pdf");
      await writeSkill(join(CODEX_LEGACY, ".system", "sys"), "sys");
      const alpha = join(HOME, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
      await writeSkill(join(alpha, "skills", "one"), "one");
      await writeJson(INSTALLED, {
        version: 2,
        plugins: {
          "alpha@market": [{ scope: "user", installPath: alpha }],
          "gamma@market": [{ scope: "project", projectPath: join(HOME, "work"), installPath: alpha }],
        },
      });
      await writeJson(join(HOME, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });
      const delta = join(HOME, ".codex", "plugins", "cache", "mkt", "delta");
      await writeSkill(join(delta, "1.0.0", "skills", "old-skill"), "old-skill");
      await writeSkill(join(delta, "2.0.0", "skills", "new-skill"), "new-skill");
      await writeFile(join(HOME, ".codex", "config.toml"), '[plugins."delta@mkt"]\nenabled = true\n');
      // A local identity, so the scan's own handle lookup runs too.
      await mkdir(join(HOME, ".skillet"), { recursive: true, mode: 0o700 });
      await writeFile(
        join(HOME, ".skillet", "identity.json"),
        JSON.stringify({
          handle: "test-handle",
          keyId: "test-key",
          registryUrl: "http://127.0.0.1:9",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        { mode: 0o600 },
      );

      const before = snapshotTree(HOME);
      const fetchSpy = vi.fn(async () => {
        throw new Error("the map scan must not touch the network");
      });
      vi.stubGlobal("fetch", fetchSpy);

      const result = await scanMap({ adapters: [codex(), claude()] });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(snapshotTree(HOME)).toEqual(before);
      // And it did read the home: the handle came from the identity file.
      expect(result.entries.find((e) => e.name === "festival-ops")?.source).toBe("skillet-own");
      expect(result.entries.map((e) => e.name).sort()).toEqual([
        "agent-browser",
        "brand-voice",
        "festival-ops",
        "helper",
        "linked",
        "linky",
        "new-skill",
        "one",
        "pdf",
        "with-git",
      ]);
      expect(result.unreadable.map((u) => u.reason).sort()).toEqual(["broken-link", "project-plugin"]);
    },
  );
});

// ---------------------------------------------------------------------------
// The same answer however the folders are read
// ---------------------------------------------------------------------------

/** The scan with every path under the fixture home spelled `<home>`, less its clock. */
function pinnedScan(result: Awaited<ReturnType<typeof scanMap>>): unknown {
  const real = realpathSync(HOME);
  const entries = result.entries.map((e) => ({
    key: e.key,
    name: e.name,
    description: e.description,
    source: e.source,
    owner: e.owner,
    tools: e.tools,
    copies: e.copies,
    locations: e.locations,
    jobId: e.jobId,
    flags: e.flags,
  }));
  const text = JSON.stringify({ entries, tools: result.tools, folders: result.folders, unreadable: result.unreadable });
  return JSON.parse(text.split(real).join("<home>").split(HOME).join("<home>")) as unknown;
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
/** The result below, as the scan gave it before it read skills in parallel off directory entries. */
const PINNED_SCAN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "map-scan-pinned.json");

describe("scanMap: the same result however the folders are read", () => {
  // Pinned from the scan as it read folders one entry and one skill at a time,
  // with an lstat per entry: links inside, outside and broken, a folder that
  // can't be listed, one whose subfolder can't be, and a linked skill folder.
  it.skipIf(!symlinksAvailable || isRoot || process.platform === "win32")(
    "a fixture with links, unreadable folders and a folder link scans to the pinned result",
    async () => {
      const locked = [join(CLAUDE, "locked"), join(CLAUDE, "locked-inner", "references")];
      try {
        await mkdir(join(HOME, "shared"), { recursive: true });
        await writeFile(join(HOME, "shared", "notes.md"), "shared notes\n");
        await writeSkill(join(HOME, "src", "entry"), "linked-entry");
        await writeSkill(join(HOME, "src", "linked-skill"), "linked-skill", { "references/guide.md": "guide\n" });

        await writeSkill(join(CLAUDE, "alpha"), "alpha");
        await writeSkill(join(AGENTS, "alpha"), "alpha");
        await writeSkill(join(AGENTS, "agents-only"), "agents-only", { "scripts/run.sh": "echo hi\n" });
        for (const name of ["b1", "b2", "b3", "b4", "b5", "b6"]) await writeSkill(join(CLAUDE, name), name);
        await writeSkill(join(CLAUDE, "deep"), "deep", { "a/b/c/d.md": "deep\n", ".DS_Store": "finder", ".git/HEAD": "ref\n" });
        await writeFile(join(CLAUDE, "README.md"), "not a skill\n");

        // Links inside the skill: a file and a folder.
        await writeSkill(join(CLAUDE, "inside-link"), "inside-link", { "references/a.md": "a\n" });
        await symlink(join(CLAUDE, "inside-link", "references", "a.md"), join(CLAUDE, "inside-link", "alias.md"), "file");
        await symlink(join(CLAUDE, "inside-link", "references"), join(CLAUDE, "inside-link", "refs"), "dir");
        // Links out of the skill: a file and a folder.
        await writeSkill(join(CLAUDE, "outside-link"), "outside-link");
        await symlink(join(HOME, "shared", "notes.md"), join(CLAUDE, "outside-link", "notes.md"), "file");
        await symlink(join(HOME, "shared"), join(CLAUDE, "outside-link", "shared"), "dir");
        // A broken link inside a skill, and a SKILL.md that is a broken link.
        await writeSkill(join(CLAUDE, "broken-inner"), "broken-inner");
        await symlink(join(HOME, "gone.md"), join(CLAUDE, "broken-inner", "gone.md"), "file");
        await mkdir(join(CLAUDE, "broken-entry"), { recursive: true });
        await symlink(join(HOME, "gone", "SKILL.md"), join(CLAUDE, "broken-entry", "SKILL.md"), "file");
        // A SKILL.md linked from outside, a linked skill folder, and a link to nowhere.
        await mkdir(join(CLAUDE, "linked-entry"), { recursive: true });
        await symlink(join(HOME, "src", "entry", "SKILL.md"), join(CLAUDE, "linked-entry", "SKILL.md"), "file");
        await symlink(join(HOME, "src", "linked-skill"), join(CLAUDE, "folder-link"), "dir");
        await symlink(join(HOME, "nowhere"), join(CLAUDE, "dangling"), "dir");
        // Folders that can't be read: a skill, and one skill's subfolder.
        await writeSkill(join(CLAUDE, "locked"), "locked");
        await writeSkill(join(CLAUDE, "locked-inner"), "locked-inner", { "references/x.md": "x\n" });
        await writeSkill(join(CLAUDE, "synced", "acme", "brand-voice"), "brand-voice");
        await writeSkill(join(CLAUDE, "someapp", "skills", "helper"), "helper");
        const alpha = join(HOME, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
        await writeSkill(join(alpha, "skills", "one"), "one");
        await writeSkill(join(alpha, "skills", "two"), "two", { "references/r.md": "r\n" });
        await writeJson(INSTALLED, {
          version: 2,
          plugins: { "alpha@market": [{ scope: "user", installPath: alpha, version: "1.0.0" }] },
        });
        await writeJson(join(HOME, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });
        for (const dir of locked) await chmod(dir, 0o000);

        const result = await scanMap({ adapters: [codex(), claude()], handle: null });
        expect(pinnedScan(result)).toEqual(JSON.parse(readFileSync(PINNED_SCAN, "utf8")));
      } finally {
        for (const dir of locked) await chmod(dir, 0o755).catch(() => undefined);
      }
    },
  );
});
