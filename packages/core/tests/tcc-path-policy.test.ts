/**
 * TCC path policy (U2): launch-path content reads run only on roots whose
 * fully RESOLVED path lies outside ~/Documents, ~/Desktop, ~/Downloads.
 *
 * The helper must canonicalize BOTH sides of the containment check: on macOS
 * temp dirs live under /var → /private/var, so an unresolved anchor (or an
 * unresolved candidate) false-negatives and the sidecar trips the TCC
 * "access your Documents folder" prompt at app launch.
 *
 * HOME here is the hermetic sandbox from test-env-setup; each test builds its
 * own decoy home and restores env in afterEach. Never touches the real home.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { symlinksAvailable } from "./symlink-support.js";

import { isTccProtectedPath } from "../src/util/pathsafe.js";
import { detectDriftedGlobalCopies } from "../src/commands/edits-store.js";
import type { Adapter } from "../src/adapter.js";

let home: string;
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(async () => {
  savedHome = process.env["HOME"];
  savedUserProfile = process.env["USERPROFILE"];
  home = await mkdtemp(join(tmpdir(), "skillet-tcc-policy-"));
  process.env["HOME"] = home;
  if (process.platform === "win32") process.env["USERPROFILE"] = home;
  // The policy is macOS-only; force it on so the decoy folders park anywhere.
  process.env["SKILLET_TCC_POLICY"] = "force";
});

afterEach(async () => {
  if (savedHome !== undefined) process.env["HOME"] = savedHome;
  else delete process.env["HOME"];
  if (process.platform === "win32") {
    if (savedUserProfile !== undefined) process.env["USERPROFILE"] = savedUserProfile;
    else delete process.env["USERPROFILE"];
  }
  delete process.env["SKILLET_TCC_POLICY"];
  await rm(home, { recursive: true, force: true });
});

describe("isTccProtectedPath", () => {
  it("a normal dotfile root passes the policy (not protected)", async () => {
    const root = join(home, ".claude", "skills");
    await mkdir(root, { recursive: true });
    expect(isTccProtectedPath(root)).toBe(false);
  });

  it("paths under ~/Documents, ~/Desktop, ~/Downloads are protected", async () => {
    for (const name of ["Documents", "Desktop", "Downloads"]) {
      const dir = join(home, name, "stuff");
      await mkdir(dir, { recursive: true });
      expect(isTccProtectedPath(dir)).toBe(true);
      // The protected folder itself is protected too.
      expect(isTccProtectedPath(join(home, name))).toBe(true);
    }
  });

  it("a NONEXISTENT path under ~/Documents is still protected (deepest-ancestor resolve)", async () => {
    // Neither Documents nor the leaf exists — ENOENT must not read as safe.
    expect(isTccProtectedPath(join(home, "Documents", "nope", "deep"))).toBe(true);
  });

  it("a sibling whose name merely starts with a protected name is NOT protected", async () => {
    const dir = join(home, "DocumentsBackup", "x");
    await mkdir(dir, { recursive: true });
    expect(isTccProtectedPath(dir)).toBe(false);
  });

  it.skipIf(!symlinksAvailable)("a dotfile root SYMLINKED into ~/Documents is protected (candidate realpath)", async () => {
    const decoy = join(home, "Documents", "claude-skills");
    await mkdir(decoy, { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    const root = join(home, ".claude", "skills");
    await symlink(decoy, root);
    expect(isTccProtectedPath(root)).toBe(true);
    // A path below the symlinked root is protected too.
    expect(isTccProtectedPath(join(root, "some-skill"))).toBe(true);
  });

  it.skipIf(!symlinksAvailable)("canonicalizes BOTH sides: symlinked HOME (the /var -> /private/var case)", async () => {
    // Real home dir + a symlink to it. HOME is set to the SYMLINK spelling,
    // and the candidate is given via the REAL spelling — only resolving both
    // the anchor and the candidate makes them meet.
    const homeReal = join(home, "real-home");
    await mkdir(join(homeReal, "Documents", "skills"), { recursive: true });
    const homeLink = join(home, "home-link");
    await symlink(homeReal, homeLink);
    process.env["HOME"] = homeLink;
    if (process.platform === "win32") process.env["USERPROFILE"] = homeLink;

    expect(isTccProtectedPath(join(homeReal, "Documents", "skills"))).toBe(true);
    expect(isTccProtectedPath(join(homeLink, "Documents", "skills"))).toBe(true);
    expect(isTccProtectedPath(join(homeReal, "elsewhere"))).toBe(false);
  });

  it("empty and null-byte candidates are not protected (no throw)", () => {
    expect(isTccProtectedPath("")).toBe(false);
    expect(isTccProtectedPath("/tmp/\x00x")).toBe(false);
  });
});

describe("detectDriftedGlobalCopies with a parked root", () => {
  const adapter = (name: string, base: string): Adapter =>
    ({
      name,
      kind: "global",
      targetDir: base,
      detect: async () => true,
      materialize: async () => [],
      targetSkillDir: (slug: string, opts?: { owner?: string | null }) =>
        join(base, `${opts?.owner ?? "_local"}--${slug}`),
    }) as unknown as Adapter;

  it.skipIf(!symlinksAvailable)("classifies a parked root as parked, never drifted and never uncapturable", async () => {
    // Root symlinked into a decoy Documents, holding bytes that differ from
    // the baseline. Without the policy this would read as a hand edit (drift)
    // or an edit_unreadable failure — both wrong for a root we must not read.
    const decoy = join(home, "Documents", "claude-decoy");
    await mkdir(join(decoy, "alice--x"), { recursive: true });
    await writeFile(join(decoy, "alice--x", "SKILL.md"), "# edited bytes\n");
    const root = join(home, ".claude-skills");
    await symlink(decoy, root);

    const clean = join(home, ".codex-skills");
    await mkdir(join(clean, "alice--x"), { recursive: true });
    await writeFile(join(clean, "alice--x", "SKILL.md"), "# baseline\n");

    const detection = await detectDriftedGlobalCopies(
      [adapter("claude-code", root), adapter("codex", clean)],
      "x",
      "alice",
      "sha256:not-the-on-disk-hash",
    );

    expect(detection.parked.map((p) => p.adapter)).toEqual(["claude-code"]);
    expect(detection.drifted.map((d) => d.adapter)).toEqual(["codex"]);
    expect(detection.uncapturable).toEqual([]);
  });
});
