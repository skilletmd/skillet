import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, validateMaterializationPath: vi.fn() };
});
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createAdapter } from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    out.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return out;
}

describe("devin adapter contract (global ~/.config/devin/skills)", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-devin-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name is 'devin'", () => {
    expect(adapter.name).toBe("devin");
  });

  it("targetDir matches the baseDir passed to createAdapter", () => {
    expect(adapter.targetDir).toBe(tmpBase);
  });

  it("targetPath returns <baseDir>/<owner>--<slug>/SKILL.md when owner is given", () => {
    expect(adapter.targetPath("my-skill", { owner: "@taylor" })).toBe(
      join(tmpBase, "@taylor--my-skill", "SKILL.md"),
    );
  });

  it("targetPath uses the _local-- prefix when owner is absent", () => {
    expect(adapter.targetPath("my-skill")).toBe(join(tmpBase, "_local--my-skill", "SKILL.md"));
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil")).toThrow(/Unsafe skill slug rejected/);
    expect(() => adapter.targetPath("foo/bar")).toThrow(/Unsafe skill slug rejected/);
  });

  it("materialize writes the full SKILL.md bundle tree (native format, not .devin/rules)", async () => {
    const content = "---\nname: Test\n---\n";
    const written = await adapter.materialize(
      "test-skill",
      bundle({ "SKILL.md": content, "references/p.md": "ref" }),
      { owner: "@alice" },
    );
    const root = join(tmpBase, "@alice--test-skill");
    expect(written).toEqual([join(root, "SKILL.md"), join(root, "references", "p.md")]);
    expect(await readFile(join(root, "SKILL.md"), "utf8")).toBe(content);
  });

  it("materialize preserves binary bytes", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    await adapter.materialize("bin", bundle({ "SKILL.md": "x", "references/p.pdf": bytes }));
    const onDisk = await readFile(join(tmpBase, "_local--bin", "references", "p.pdf"));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("materialize rejects unsafe slugs", async () => {
    await expect(adapter.materialize("../evil", bundle({ "SKILL.md": "x" }))).rejects.toThrow();
  });

  it("materialize overwrites on re-run and leaves no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "original" }));
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "updated" }));
    const dest = join(tmpBase, "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("updated");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("detect returns a boolean", async () => {
    expect(typeof (await adapter.detect())).toBe("boolean");
  });
});

describe("devin adapter detection (U1/U7)", () => {
  let savedPath: string | undefined;
  beforeEach(() => {
    savedPath = process.env["PATH"];
  });
  afterEach(() => {
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
  });

  it("detects via its config dir (filesystem marker), never executes a binary", async () => {
    // createAdapter(baseDir): detect checks dirname(baseDir). Point it at an
    // existing dir's child so the marker resolves without touching ~/.config.
    const base = join(tmpdir(), `skillet-devin-detect-${randomBytes(4).toString("hex")}`);
    await mkdir(base, { recursive: true });
    const a = createAdapter(join(base, "skills"));
    expect(await a.detect()).toBe(true);
    await rm(base, { recursive: true, force: true });
  });

  it("does NOT claim a machine with only Devin.app (no config dir, no PATH binary)", async () => {
    // Point the config dir at a nonexistent tree and clear PATH: the adapter
    // must stay undetected — /Applications/Devin.app is the editor (windsurf
    // adapter owns it), and the devin adapter no longer probes it.
    const absent = join(tmpdir(), `skillet-devin-absent-${randomBytes(4).toString("hex")}`, "skills");
    process.env["PATH"] = "";
    const a = createAdapter(absent);
    expect(await a.detect()).toBe(false);
  });

  it("detects a `devin` binary on PATH via existence, not execution", async () => {
    const absentBase = join(tmpdir(), `skillet-devin-nocfg-${randomBytes(4).toString("hex")}`);
    const binDir = join(tmpdir(), `skillet-devin-bin-${randomBytes(4).toString("hex")}`);
    await mkdir(binDir, { recursive: true });
    // An extensionless `devin` is not executable on Windows, and the adapter
    // correctly looks for devin.exe/.cmd/.bat there — so the fixture has to use
    // a name the host platform would actually resolve.
    const binName = process.platform === "win32" ? "devin.exe" : "devin";
    await writeFile(join(binDir, binName), "#!/bin/sh\necho should-never-run\n");
    process.env["PATH"] = binDir;
    const a = createAdapter(join(absentBase, "skills")); // config dir absent
    expect(await a.detect()).toBe(true);
    await rm(binDir, { recursive: true, force: true });
  });
});

describe("U2: TCC-parked PATH entries are never probed", () => {
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedPath: string | undefined;

  beforeEach(async () => {
    savedHome = process.env["HOME"];
    savedUserProfile = process.env["USERPROFILE"];
    savedPath = process.env["PATH"];
    fakeHome = join(tmpdir(), `skillet-devin-home-${randomBytes(4).toString("hex")}`);
    await mkdir(fakeHome, { recursive: true });
    process.env["HOME"] = fakeHome;
    if (process.platform === "win32") process.env["USERPROFILE"] = fakeHome;
    // The TCC policy is macOS-only; force it on so the decoy Documents parks anywhere.
    process.env["SKILLET_TCC_POLICY"] = "force";
  });

  afterEach(async () => {
    delete process.env["SKILLET_TCC_POLICY"];
    if (savedHome !== undefined) process.env["HOME"] = savedHome;
    else delete process.env["HOME"];
    if (process.platform === "win32") {
      if (savedUserProfile !== undefined) process.env["USERPROFILE"] = savedUserProfile;
      else delete process.env["USERPROFILE"];
    }
    if (savedPath !== undefined) process.env["PATH"] = savedPath;
    else delete process.env["PATH"];
    await rm(fakeHome, { recursive: true, force: true });
  });

  const exeName = process.platform === "win32" ? "devin.exe" : "devin";

  it("a devin binary in a PATH entry under ~/Documents does NOT detect", async () => {
    const binDir = join(fakeHome, "Documents", "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, exeName), "#!/bin/sh\n");
    process.env["PATH"] = binDir;
    // baseDir's parent does not exist, so detection falls through to the PATH
    // scan — which must skip the protected entry entirely.
    const missing = join(fakeHome, "missing-config", "devin", "skills");
    expect(await createAdapter(missing).detect()).toBe(false);
  });

  it("a devin binary in an unprotected PATH entry still detects", async () => {
    const binDir = join(fakeHome, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, exeName), "#!/bin/sh\n");
    process.env["PATH"] = binDir;
    const missing = join(fakeHome, "missing-config", "devin", "skills");
    expect(await createAdapter(missing).detect()).toBe(true);
  });
});
