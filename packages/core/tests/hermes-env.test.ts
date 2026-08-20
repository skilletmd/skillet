/**
 * HERMES_HOME env override tests.
 *
 * HERMES_ENV_ROOT is a module-level constant computed at import time.
 * Each test resets the module cache and re-imports pathsafe.ts with a fresh
 * HERMES_HOME value to exercise the four SecEng-required guards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

function realpath(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

describe("HERMES_HOME env override", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `skillet-hermes-env-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpDir, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("AC5-1: HERMES_HOME set to existing dir → HERMES_ENV_ROOT is <dir>/skills", async () => {
    vi.stubEnv("HERMES_HOME", tmpDir);
    const { HERMES_ENV_ROOT } = await import("../src/util/pathsafe.js");
    // realpathSync resolves symlinks (e.g. /var → /private/var on macOS)
    expect(HERMES_ENV_ROOT).toBe(join(realpath(tmpDir), "skills"));
  });

  it("AC5-2: HERMES_HOME empty string → HERMES_ENV_ROOT is null", async () => {
    vi.stubEnv("HERMES_HOME", "");
    const { HERMES_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(HERMES_ENV_ROOT).toBeNull();
  });

  it("AC5-3: HERMES_HOME unset → HERMES_ENV_ROOT is null", async () => {
    delete process.env["HERMES_HOME"];
    const { HERMES_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(HERMES_ENV_ROOT).toBeNull();
  });

  // Node.js truncates env var values at null bytes on macOS/Linux when going
  // through the OS putenv() layer, so vi.stubEnv can't inject a real null byte
  // into process.env on this platform. The guard is verified via code review.
  it.todo("AC5-4: HERMES_HOME with null byte → throws at module load (untestable via vi.stubEnv on macOS)");

  it("AC5-5: resolved HERMES_HOME path accepted by validateMaterializationPath", async () => {
    const hermesSkillsDir = join(tmpDir, "skills");
    await mkdir(hermesSkillsDir, { recursive: true });
    vi.stubEnv("HERMES_HOME", tmpDir);
    const { validateMaterializationPath } = await import("../src/util/pathsafe.js");
    expect(() =>
      validateMaterializationPath(hermesSkillsDir, "my-skill/SKILL.md"),
    ).not.toThrow();
  });

  it("AC5-6: HERMES_HOME relative path with '..' segment → throws at module load", async () => {
    vi.stubEnv("HERMES_HOME", "../../etc/cron.d");
    await expect(import("../src/util/pathsafe.js")).rejects.toThrow(
      /HERMES_HOME rejected: path traversal/,
    );
  });

  it("AC5-7: legitimate path with '..' as substring (not segment) is accepted", async () => {
    // 'company..name' has '..' as a substring, not a segment — must not reject
    const legitDir = join(tmpDir, "company..name");
    await mkdir(legitDir, { recursive: true });
    vi.stubEnv("HERMES_HOME", legitDir);
    const { HERMES_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(HERMES_ENV_ROOT).toBe(join(realpath(legitDir), "skills"));
  });
});

describe("CLAUDE_CONFIG_DIR env override (U3)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `skillet-claude-env-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpDir, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("set to an existing dir → CLAUDE_ENV_ROOT is <dir>/skills", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", tmpDir);
    const { CLAUDE_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(CLAUDE_ENV_ROOT).toBe(join(realpath(tmpDir), "skills"));
  });

  it("empty string → CLAUDE_ENV_ROOT is null (falls back to ~/.claude)", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "");
    const { CLAUDE_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(CLAUDE_ENV_ROOT).toBeNull();
  });

  it("unset → CLAUDE_ENV_ROOT is null", async () => {
    delete process.env["CLAUDE_CONFIG_DIR"];
    const { CLAUDE_ENV_ROOT } = await import("../src/util/pathsafe.js");
    expect(CLAUDE_ENV_ROOT).toBeNull();
  });

  it("set-but-invalid (traversal segment) → throws at module load, never silent fallback", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "../../etc/cron.d");
    await expect(import("../src/util/pathsafe.js")).rejects.toThrow(
      /CLAUDE_CONFIG_DIR rejected: path traversal/,
    );
  });

  it("resolved root accepted by validateMaterializationPath", async () => {
    const skillsDir = join(tmpDir, "skills");
    await mkdir(skillsDir, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", tmpDir);
    const { validateMaterializationPath } = await import("../src/util/pathsafe.js");
    expect(() => validateMaterializationPath(skillsDir, "my-skill/SKILL.md")).not.toThrow();
  });
});

describe("Hermes active-profile targeting (U4)", () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `skillet-hermes-profile-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpHome, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("active_profile 'work' → hermesProfileRoot() is <home>/profiles/work/skills", async () => {
    await writeFile(join(tmpHome, "active_profile"), "work\n");
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    expect(hermesProfileRoot()).toBe(join(realpath(tmpHome), "profiles", "work", "skills"));
  });

  it("active_profile 'default' → null (default tree)", async () => {
    await writeFile(join(tmpHome, "active_profile"), "default");
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    expect(hermesProfileRoot()).toBeNull();
  });

  it("no active_profile file → null", async () => {
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    expect(hermesProfileRoot()).toBeNull();
  });

  it("active_profile with a path separator → rejected, null (never widens the write root)", async () => {
    await writeFile(join(tmpHome, "active_profile"), "../evil");
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    expect(hermesProfileRoot()).toBeNull();
  });

  it("U2: the profile read is LAZY — module load reads nothing (file deleted after import still yields null)", async () => {
    // If the read happened at module load, deleting the file afterward would
    // not matter. It must: the first hermesProfileRoot() call does the read.
    await writeFile(join(tmpHome, "active_profile"), "work");
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    await rm(join(tmpHome, "active_profile"), { force: true });
    expect(hermesProfileRoot()).toBeNull();
  });

  it("U2: a profile written AFTER import still resolves on first gated use", async () => {
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    await writeFile(join(tmpHome, "active_profile"), "work");
    expect(hermesProfileRoot()).toBe(join(realpath(tmpHome), "profiles", "work", "skills"));
  });

  it("U2: compute-once — a mid-session profile switch takes effect next process", async () => {
    await writeFile(join(tmpHome, "active_profile"), "work");
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    expect(hermesProfileRoot()).toBe(join(realpath(tmpHome), "profiles", "work", "skills"));
    await writeFile(join(tmpHome, "active_profile"), "other");
    expect(hermesProfileRoot()).toBe(join(realpath(tmpHome), "profiles", "work", "skills"));
  });

  /** Decoy Documents fixture for the invocation-aware gate tests: a Hermes
   *  home resolving into <fakeHome>/Documents with a valid active profile. */
  async function decoyDocumentsHermesHome(): Promise<string> {
    const fakeHome = join(tmpHome, "fake-home");
    const hermesHome = join(fakeHome, "Documents", "hermes");
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, "active_profile"), "work");
    vi.stubEnv("HOME", fakeHome);
    if (process.platform === "win32") vi.stubEnv("USERPROFILE", fakeHome);
    vi.stubEnv("HERMES_HOME", hermesHome);
    // The policy is macOS-only; force it on so the decoy Documents parks anywhere.
    vi.stubEnv("SKILLET_TCC_POLICY", "force");
    return hermesHome;
  }

  it("U2/U3: decoy Documents, unattended → null, active_profile never read (module load reads nothing)", async () => {
    const hermesHome = await decoyDocumentsHermesHome();
    // Record every sync content read (same patch+syncBuiltinESMExports
    // technique as tcc-parked-store.test.ts) across module load AND the
    // accessor call: a parked home must produce zero active_profile reads.
    // Patch the mutable CJS default export (the ESM namespace is frozen),
    // then syncBuiltinESMExports so the module under test sees the patch.
    const fsSync = (await import("node:fs")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const recorded: string[] = [];
    const origReadFileSync = fsSync.readFileSync;
    (fsSync as unknown as { readFileSync: unknown }).readFileSync = function (
      this: unknown,
      p: unknown,
      ...rest: unknown[]
    ) {
      if (typeof p === "string") recorded.push(p);
      return (origReadFileSync as (...a: unknown[]) => unknown).call(this, p, ...rest);
    };
    syncBuiltinESMExports();
    try {
      const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
      // No TTY and no explicit signal in the test runner → unattended, the
      // fail-closed class: a valid profile file exists, but the home is
      // parked, so the profile is invisible — the gate suppressed the read.
      expect(hermesProfileRoot()).toBeNull();
    } finally {
      (fsSync as unknown as { readFileSync: unknown }).readFileSync = origReadFileSync;
      syncBuiltinESMExports();
    }
    expect(recorded.filter((p) => p.endsWith("active_profile"))).toEqual([]);
    expect(recorded.filter((p) => p.includes(hermesHome))).toEqual([]);
  });

  it("U3: decoy Documents, user-initiated → resolves the real active-profile tree", async () => {
    const hermesHome = await decoyDocumentsHermesHome();
    const { hermesProfileRoot, setTccInvocation, resetTccInvocation } = await import(
      "../src/util/tcc-access.js"
    );
    try {
      setTccInvocation({ initiation: "user" });
      // The user asked: the gate admits the content read and the active
      // profile targets normally even under a protected-resolving home.
      expect(hermesProfileRoot()).toBe(
        join(realpath(hermesHome), "profiles", "work", "skills"),
      );
    } finally {
      resetTccInvocation();
    }
  });

  it("U3: decoy Documents, background WITH an active same-context grant → resolves", async () => {
    const hermesHome = await decoyDocumentsHermesHome();
    const { hermesProfileRoot, recordTccGrant, setTccInvocation, resetTccInvocation } =
      await import("../src/util/tcc-access.js");
    try {
      // No grant: a background run stays parked (fail closed).
      setTccInvocation({ initiation: "background" });
      expect(hermesProfileRoot()).toBeNull();
      // With an active marker earned by the same context, the granted root
      // re-admits background reads — the tray's automatic runs keep working.
      recordTccGrant(hermesHome, "cli");
      expect(hermesProfileRoot()).toBe(
        join(realpath(hermesHome), "profiles", "work", "skills"),
      );
    } finally {
      resetTccInvocation();
    }
  });

  it("profile skills root accepted by validateMaterializationPath after first gated use", async () => {
    await writeFile(join(tmpHome, "active_profile"), "work");
    const profileSkills = join(tmpHome, "profiles", "work", "skills");
    await mkdir(profileSkills, { recursive: true });
    vi.stubEnv("HERMES_HOME", tmpHome);
    const { validateMaterializationPath } = await import("../src/util/pathsafe.js");
    const { hermesProfileRoot } = await import("../src/util/tcc-access.js");
    // U2: the profile root joins the runtime allowlist on first accessor call
    // (the hermes adapter resolves its targetDir through it), no longer at
    // module load.
    expect(hermesProfileRoot()).toBe(join(realpath(tmpHome), "profiles", "work", "skills"));
    expect(() => validateMaterializationPath(profileSkills, "s/SKILL.md")).not.toThrow();
  });
});
