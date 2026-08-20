/**
 * Contract test: import → mutate → sync → verify file contents on disk
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { sha256, hashRef } from "../src/util/hash.js";
import { slugify } from "../src/commands/import.js";
import {
  assertSafe,
  assertSafeSlug,
  validateMaterializationPath,
  validateAdapterRoot,
  MATERIALIZATION_ROOT_ALLOWLIST,
} from "../src/util/pathsafe.js";
import { atomicWrite } from "../src/util/atomic.js";
import { homedir } from "node:os";

function makeTestSkillContent(name: string, description = "A test skill"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nThis skill does something useful.\n`;
}

// -------------------------------------------------------------------
// Unit: hash
// -------------------------------------------------------------------

describe("util/hash", () => {
  it("produces consistent sha256 hex", () => {
    const h = sha256("hello");
    expect(h).toHaveLength(64);
    expect(sha256("hello")).toBe(h);
  });

  it("hashRef prefixes sha256:", () => {
    expect(hashRef("abc")).toBe("sha256:abc");
  });
});

// -------------------------------------------------------------------
// Unit: pathsafe
// -------------------------------------------------------------------

describe("util/pathsafe", () => {
  it("allows a normal slug inside root", () => {
    expect(() => assertSafe("/home/user/.claude/skills", "my-skill")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() =>
      assertSafe("/home/user/.claude/skills", "../../../etc/passwd")
    ).toThrow(/Path escape rejected/);
  });

  it("rejects absolute path as target", () => {
    expect(() =>
      assertSafe("/home/user/.claude/skills", "/etc/passwd")
    ).toThrow(/Path escape rejected/);
  });

  it("allows valid slugs", () => {
    expect(() => assertSafeSlug("my-skill")).not.toThrow();
    expect(() => assertSafeSlug("skill_v2.0")).not.toThrow();
    expect(() => assertSafeSlug("a")).not.toThrow();
  });

  it("rejects slugs with traversal", () => {
    expect(() => assertSafeSlug("../evil")).toThrow(/Unsafe skill slug rejected/);
    expect(() => assertSafeSlug("..")).toThrow(/Unsafe skill slug rejected/);
    expect(() => assertSafeSlug("foo/bar")).toThrow(/Unsafe skill slug rejected/);
  });

  it("rejects empty or special-char slugs", () => {
    expect(() => assertSafeSlug("")).toThrow(/Unsafe skill slug rejected/);
    expect(() => assertSafeSlug("skill name")).toThrow(/Unsafe skill slug rejected/);
  });
});

// -------------------------------------------------------------------
// Unit: validateMaterializationPath
// -------------------------------------------------------------------

describe("util/validateMaterializationPath", () => {
  // Use a real allowlisted root so allowlist check passes and path checks run.
  const ALLOWED_ROOT = join(homedir(), ".claude", "skills");

  it("allows a normal slug inside root", () => {
    expect(() => validateMaterializationPath(ALLOWED_ROOT, "my-skill")).not.toThrow();
  });

  it("rejects null byte in slug", () => {
    expect(() =>
      validateMaterializationPath(ALLOWED_ROOT, "skill\0evil")
    ).toThrow(/null byte/);
  });

  it("rejects null byte in baseDir", () => {
    expect(() =>
      validateMaterializationPath(`${ALLOWED_ROOT}\0`, "skill")
    ).toThrow(/null byte/);
  });

  it("rejects path traversal in slug", () => {
    expect(() =>
      validateMaterializationPath(ALLOWED_ROOT, "../../../etc/passwd")
    ).toThrow(/Path escape rejected/);
  });

  it("rejects absolute path as slug", () => {
    expect(() =>
      validateMaterializationPath(ALLOWED_ROOT, "/etc/passwd")
    ).toThrow(/Path escape rejected/);
  });
});

// -------------------------------------------------------------------
// Unit: MATERIALIZATION_ROOT_ALLOWLIST coverage
// -------------------------------------------------------------------

describe("MATERIALIZATION_ROOT_ALLOWLIST", () => {
  const home = homedir();

  const expectedRoots = [
    { runtime: "claude-code", dir: join(home, ".claude", "skills") },
    { runtime: "codex", dir: join(home, ".agents", "skills") },
    { runtime: "openclaw", dir: join(home, ".openclaw", "skills") },
    { runtime: "hermes", dir: join(home, ".hermes", "skills") },
  ];

  for (const { runtime, dir } of expectedRoots) {
    it(`covers ${runtime} default targetDir`, () => {
      expect(MATERIALIZATION_ROOT_ALLOWLIST).toContain(dir);
    });
  }

  it("does NOT include the deprecated codex path ~/.codex/skills", () => {
    expect(MATERIALIZATION_ROOT_ALLOWLIST).not.toContain(
      join(home, ".codex", "skills"),
    );
  });

  it("does NOT include ~/.cursor/skills (cursor is now project-scoped, uses .cursor/rules)", () => {
    expect(MATERIALIZATION_ROOT_ALLOWLIST).not.toContain(
      join(home, ".cursor", "skills"),
    );
  });

  it("includes ~/.codeium/windsurf/skills (Devin Desktop native skills folder)", () => {
    expect(MATERIALIZATION_ROOT_ALLOWLIST).toContain(
      join(home, ".codeium", "windsurf", "skills"),
    );
  });

  it("is frozen (not mutable at runtime)", () => {
    expect(Object.isFrozen(MATERIALIZATION_ROOT_ALLOWLIST)).toBe(true);
    expect(() => {
      (MATERIALIZATION_ROOT_ALLOWLIST as string[]).push("/tmp/attacker");
    }).toThrow();
  });
});

// -------------------------------------------------------------------
// Unit: validateAdapterRoot
// -------------------------------------------------------------------

describe("util/validateAdapterRoot", () => {
  it("accepts an adapter whose targetDir is in the allowlist", () => {
    const adapter = {
      name: "claude-code",
      targetDir: join(homedir(), ".claude", "skills"),
      detect: async () => true,
      materialize: async () => "",
      targetPath: () => "",
    };
    expect(() => validateAdapterRoot(adapter)).not.toThrow();
  });

  it("rejects an adapter with a targetDir not in the allowlist", () => {
    const adapter = {
      name: "evil",
      targetDir: "/tmp/attacker-controlled",
      detect: async () => true,
      materialize: async () => "",
      targetPath: () => "",
    };
    expect(() => validateAdapterRoot(adapter)).toThrow(/not in the per-runtime allowlist/);
  });
});

// -------------------------------------------------------------------
// Unit: atomic write
// -------------------------------------------------------------------

describe("util/atomic", () => {
  it("writes content to dest", async () => {
    const dir = join(tmpdir(), `skillet-atomic-${randomBytes(4).toString("hex")}`);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, "test.md");
    await atomicWrite(dest, "hello world");
    expect(await readFile(dest, "utf8")).toBe("hello world");
    await rm(dir, { recursive: true });
  });

  it("creates a .skillet-backup before overwriting", async () => {
    const dir = join(tmpdir(), `skillet-backup-${randomBytes(4).toString("hex")}`);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, "test.md");
    await writeFile(dest, "original content");
    await atomicWrite(dest, "new content", { backup: true });
    expect(await readFile(dest, "utf8")).toBe("new content");
    expect(await readFile(`${dest}.skillet-backup`, "utf8")).toBe("original content");
    await rm(dir, { recursive: true });
  });
});

// -------------------------------------------------------------------
// Integration: import → mutate → sync contract test
// -------------------------------------------------------------------

describe("Contract: import → mutate → sync → verify", () => {
  let tmpBase: string;
  let claudeSkillsDir: string;
  let cwd: string;

  beforeEach(async () => {
    const id = randomBytes(8).toString("hex");
    tmpBase = join(tmpdir(), `skillet-contract-${id}`);
    claudeSkillsDir = join(tmpBase, ".claude", "skills");
    cwd = join(tmpBase, "project");
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("full contract: import → mutate → sync → verify", async () => {
    // 1. Create source skill
    const skillSrcDir = join(tmpBase, "my-skill");
    await mkdir(skillSrcDir, { recursive: true });
    const skillPath = join(skillSrcDir, "SKILL.md");
    const initialContent = makeTestSkillContent("My Test Skill", "Does test things");
    await writeFile(skillPath, initialContent);

    // 2. Simulate import (pure functions, isolated from real ~/.skillet)
    const matter = (await import("gray-matter")).default;
    const content = await readFile(skillPath, "utf8");
    const parsed = matter(content);
    const fm = parsed.data as Record<string, unknown>;
    const name = typeof fm["name"] === "string" ? fm["name"] : "My Test Skill";
    const slug = slugify(name);

    assertSafeSlug(slug);
    const hash = sha256(content);

    // Store in test-isolated skillet dir
    const skilletDir = join(tmpBase, ".skillet");
    const skillStorePath = join(skilletDir, "skills", slug, "SKILL.md");
    const stateFile = join(skilletDir, "state.json");
    await atomicWrite(skillStorePath, content, { backup: false });
    const now = new Date().toISOString();
    const entry = {
      slug, name, description: "Does test things",
      version: 1, hash, source: "local", importedAt: now, updatedAt: now,
    };
    await atomicWrite(stateFile, JSON.stringify({ version: 1, skills: { [slug]: entry } }, null, 2), { backup: false });

    // 3. Verify kit state
    const state = JSON.parse(await readFile(stateFile, "utf8")) as {
      skills: Record<string, typeof entry>;
    };
    expect(state.skills[slug]?.hash).toBe(hash);

    // 4. Mutate skill content
    const mutatedContent = initialContent + "\n## Extra section\n\nAdded after import.\n";
    await writeFile(skillStorePath, mutatedContent);
    const mutatedHash = sha256(mutatedContent);

    // 5. Simulate sync: materialize to claude skills dir
    const dest = join(claudeSkillsDir, slug, "SKILL.md");
    assertSafe(claudeSkillsDir, slug);
    await atomicWrite(dest, mutatedContent, { backup: false });

    // Write lock file
    const lockFile = join(cwd, "skillet.lock");
    const lock = {
      registry: "https://registry.skillet.md",
      generatedAt: now,
      skills: { [slug]: { version: 1, hash: hashRef(mutatedHash), source: "local" } },
    };
    await atomicWrite(lockFile, JSON.stringify(lock, null, 2));

    // 6. Verify file on disk matches synced content
    expect(await readFile(dest, "utf8")).toBe(mutatedContent);
    expect(await readFile(dest, "utf8")).toContain("## Extra section");

    // 7. Verify lock file shape
    const lockParsed = JSON.parse(await readFile(lockFile, "utf8")) as typeof lock;
    expect(lockParsed.registry).toBe("https://registry.skillet.md");
    expect(lockParsed.skills[slug]?.hash).toMatch(/^sha256:/);
    expect(lockParsed.skills[slug]?.hash).toBe(hashRef(mutatedHash));
  });

  it("rejects path-traversal slugs during materialize", () => {
    expect(() => assertSafe(claudeSkillsDir, "../../../etc/passwd")).toThrow(
      /Path escape rejected/
    );
    expect(() => assertSafe(claudeSkillsDir, "../../root/.ssh/authorized_keys")).toThrow(
      /Path escape rejected/
    );
  });

  it("backup is created when overwriting an existing skill", async () => {
    const dest = join(claudeSkillsDir, "test-skill", "SKILL.md");
    await mkdir(join(claudeSkillsDir, "test-skill"), { recursive: true });
    await atomicWrite(dest, "original");
    await atomicWrite(dest, "updated", { backup: true });
    expect(await readFile(dest, "utf8")).toBe("updated");
    expect(await readFile(`${dest}.skillet-backup`, "utf8")).toBe("original");
  });

  it("lockfile contains pinned registry URL", async () => {
    const lockPath = join(cwd, "skillet.lock");
    const lock = {
      registry: "https://registry.skillet.md",
      generatedAt: new Date().toISOString(),
      skills: {},
    };
    await atomicWrite(lockPath, JSON.stringify(lock, null, 2));
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as typeof lock;
    expect(parsed.registry).toBe("https://registry.skillet.md");
  });
});
