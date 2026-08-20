import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, symlink, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  canonicalContentHash,
  encodeBundle,
  decodeBundle,
} from "@skillet/protocol";
import { readBundleFromDir } from "../src/bundle/read.js";
import { writeBundleToDir, bundleSlugDir, materializeSlugDir, isSkilletSlugDirName, parseSkilletSlugDir } from "../src/bundle/write.js";
import { enforcesUnixFilePermissions } from "../src/util/unix-perms.js";

// Tests use temp dirs; mock the allowlist check so writeBundleToDir doesn't
// reject /tmp roots.
vi.mock("../src/util/pathsafe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/pathsafe.js")>();
  return { ...actual, validateMaterializationPath: vi.fn() };
});

describe("bundle: read + canonical hash + write round-trip", () => {
  let tmpBase: string;
  let skillSrc: string;
  let adapterRoot: string;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-bundle-${randomBytes(4).toString("hex")}`);
    skillSrc = join(tmpBase, "src");
    adapterRoot = join(tmpBase, "root");
    await mkdir(skillSrc, { recursive: true });
    await mkdir(adapterRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("reads a full subtree, hashes it canonically, and writes it back byte-for-byte", async () => {
    const skillMd = "---\nname: fixture\n---\n# Body\n";
    const ref = "Reference text.\n";
    const py = "print('hi')\n";
    const bin = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);

    await writeFile(join(skillSrc, "SKILL.md"), skillMd);
    await mkdir(join(skillSrc, "references"), { recursive: true });
    await writeFile(join(skillSrc, "references", "policy.md"), ref);
    await writeFile(join(skillSrc, "references", "logo.bin"), bin);
    await mkdir(join(skillSrc, "scripts", "lib", "util"), { recursive: true });
    await writeFile(join(skillSrc, "scripts", "lib", "util", "format.py"), py);

    const bundle = await readBundleFromDir(skillSrc);

    // Sanity: paths are POSIX-relative and arbitrarily nested.
    expect([...bundle.keys()].sort()).toEqual([
      "SKILL.md",
      "references/logo.bin",
      "references/policy.md",
      "scripts/lib/util/format.py",
    ]);

    const hashFromDisk = canonicalContentHash(bundle);
    expect(hashFromDisk).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Round-trip through wire format — encode then decode — and the hash
    // MUST be identical to the on-disk read.
    const reEncoded = encodeBundle(bundle);
    const reDecoded = decodeBundle(reEncoded);
    expect(canonicalContentHash(reDecoded)).toBe(hashFromDisk);

    // Materialize back to a fresh adapter root and verify byte equality.
    const slugDir = bundleSlugDir("fixture", "@alice");
    const written = await writeBundleToDir(adapterRoot, slugDir, reDecoded);
    expect(written.length).toBe(4);

    const destSkill = join(adapterRoot, slugDir, "SKILL.md");
    expect(await readFile(destSkill, "utf8")).toBe(skillMd);
    const destBin = await readFile(join(adapterRoot, slugDir, "references", "logo.bin"));
    expect(destBin.equals(bin)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects symlinks anywhere in the tree (§2.1 unsafe_path)", async () => {
    await writeFile(join(skillSrc, "SKILL.md"), "x");
    await mkdir(join(skillSrc, "references"), { recursive: true });
    // A symlink that would otherwise pull in `~/.ssh/id_ed25519`.
    await symlink("/etc/hostname", join(skillSrc, "references", "leak"));

    await expect(readBundleFromDir(skillSrc)).rejects.toThrow(/Symlink in bundle is rejected/);
  });

  it("rejects bundle without SKILL.md at root", async () => {
    await mkdir(join(skillSrc, "docs"), { recursive: true });
    await writeFile(join(skillSrc, "docs", "SKILL.md"), "x");
    await expect(readBundleFromDir(skillSrc)).rejects.toThrow(/missing required SKILL.md/);
  });

  it("excludes .skillet-backup files from the bundle", async () => {
    await writeFile(join(skillSrc, "SKILL.md"), "---\nname: x\n---\n\nbody\n");
    await writeFile(join(skillSrc, "SKILL.md.skillet-backup"), "old backup");
    const bundle = await readBundleFromDir(skillSrc);
    expect([...bundle.keys()]).toEqual(["SKILL.md"]);
  });

  it("write rejects bundle paths containing .. (defense-in-depth)", async () => {
    const bundle = new Map<string, Uint8Array>([
      ["SKILL.md", Buffer.from("x", "utf8")],
    ]);
    await expect(
      writeBundleToDir(adapterRoot, "../escape", bundle),
    ).rejects.toThrow(/Path escape rejected/);
  });

  it("uses _local-- prefix when owner is omitted", () => {
    expect(bundleSlugDir("my-skill")).toBe("_local--my-skill");
    expect(bundleSlugDir("my-skill", null)).toBe("_local--my-skill");
    expect(bundleSlugDir("my-skill", "@alice")).toBe("@alice--my-skill");
  });

  it("detects skillet slug dir names", () => {
    expect(isSkilletSlugDirName("skillet")).toBe(true);
    expect(isSkilletSlugDirName("thiago--skillet-sync")).toBe(true);
    expect(isSkilletSlugDirName("@thiago--skillet-sync")).toBe(true);
    expect(isSkilletSlugDirName("_local--my-skill")).toBe(true);
    expect(isSkilletSlugDirName("alpha")).toBe(false);
    expect(isSkilletSlugDirName("@taylor/festival-ops")).toBe(false);
  });

  it("parses skillet slug dir names", () => {
    expect(parseSkilletSlugDir("skillet")).toEqual({
      owner: "skillet",
      slug: "route",
    });
    expect(parseSkilletSlugDir("thiago--skillet-sync")).toEqual({
      owner: "thiago",
      slug: "skillet-sync",
    });
    expect(parseSkilletSlugDir("_local--draft")).toEqual({
      owner: null,
      slug: "draft",
    });
    expect(parseSkilletSlugDir("plain-skill")).toBeNull();
  });

  it("materializeSlugDir honors dirName override for bundled route", () => {
    expect(materializeSlugDir("route", "skillet", { dirName: "skillet" })).toBe(
      "skillet",
    );
  });
});
