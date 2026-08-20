/**
 * `skillet export` command tests.
 *
 * Isolation: HOME and SKILLET_DIR are set BEFORE any @skillet/core import so
 * the store reads/writes a temp dir. Core is pulled in via dynamic import after
 * the env is in place (the store captures SKILLET_DIR at module load).
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Command } from "commander";
import { unzipSync } from "fflate";

const TEST_ROOT = join(tmpdir(), `skillet-export-${randomBytes(4).toString("hex")}`);
process.env["HOME"] = TEST_ROOT;
process.env["SKILLET_DIR"] = join(TEST_ROOT, ".skillet");

const { writeBundleToSkillStore, upsertSkill } = await import("@skillet/core");
const { skillContentHash } = await import("@skillet/protocol");
const { registerExportCommand } = await import("../src/commands/export.js");

/** Seed only the state entry (no bundle on disk) to exercise store-drift paths. */
async function seedStateOnly(slug: string, owner = "me"): Promise<void> {
  await upsertSkill({
    slug,
    owner,
    name: slug,
    description: `A ${slug} skill`,
    version: 1,
    hash: "sha256:deadbeef",
    source: "local",
    sourceKit: null,
    importedAt: "2026-06-24T00:00:00Z",
    updatedAt: "2026-06-24T00:00:00Z",
  });
}

const origCwd = process.cwd();

function skillMd(name: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: A ${name} skill\n${extra}---\nBody of ${name}.`;
}

async function seed(
  slug: string,
  opts: {
    owner?: string | null;
    sourceKit?: string | null;
    quarantined?: boolean;
    extraFm?: string;
  } = {},
): Promise<void> {
  const bundle = new Map([["SKILL.md", Buffer.from(skillMd(slug, opts.extraFm ?? ""))]]);
  await writeBundleToSkillStore(slug, bundle);
  await upsertSkill({
    slug,
    owner: opts.owner ?? "me",
    name: slug,
    description: `A ${slug} skill`,
    version: 1,
    // Export verifies the store against this hash, so it must be the real one.
    hash: skillContentHash(bundle),
    source: "local",
    sourceKit: opts.sourceKit ?? null,
    scan: opts.quarantined ? ({ status: "quarantined" } as never) : undefined,
    importedAt: "2026-06-24T00:00:00Z",
    updatedAt: "2026-06-24T00:00:00Z",
  });
}

async function runExport(args: string[], cwd: string): Promise<void> {
  process.chdir(cwd);
  process.exitCode = 0;
  const program = new Command();
  program.exitOverride();
  registerExportCommand(program);
  await program.parseAsync(["node", "skillet", "export", ...args]);
}

function freshOut(): string {
  return mkdtempSync(join(TEST_ROOT, "out-"));
}

before(() => {
  // TEST_ROOT must exist before mkdtemp under it.
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_ROOT, ".skillet"), { recursive: true });
});

after(() => {
  process.chdir(origCwd);
  rmSync(TEST_ROOT, { recursive: true, force: true });
  // Tests assert the command's exit code by reading process.exitCode; clear it
  // so a trailing exit-1 case doesn't mark the whole test file as failed.
  process.exitCode = 0;
});

test("writes <slug>.zip with SKILL.md at the archive root", async () => {
  await seed("git-workflow");
  const out = freshOut();
  await runExport(["@me/git-workflow"], out);
  const zipPath = join(out, "git-workflow.zip");
  assert.ok(existsSync(zipPath));
  const files = unzipSync(readFileSync(zipPath));
  assert.deepEqual(Object.keys(files), ["SKILL.md"]);
  assert.equal(process.exitCode, 0);
});

test("resolves a bare slug as well as @owner/slug", async () => {
  await seed("deploy-ritual");
  const out = freshOut();
  await runExport(["deploy-ritual"], out);
  assert.ok(existsSync(join(out, "deploy-ritual.zip")));
});

test("streams zip bytes to stdout with --stdout", async () => {
  await seed("piped");
  const out = freshOut();
  const chunks: Buffer[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => {
    chunks.push(Buffer.from(c as Buffer));
    return true;
  }) as typeof process.stdout.write;
  try {
    await runExport(["@me/piped", "--stdout"], out);
  } finally {
    process.stdout.write = orig;
  }
  const files = unzipSync(Buffer.concat(chunks));
  assert.deepEqual(Object.keys(files), ["SKILL.md"]);
  assert.equal(existsSync(join(out, "piped.zip")), false);
});

test("non-zero exit on an unknown skill", async () => {
  const out = freshOut();
  await runExport(["@me/nope"], out);
  assert.equal(process.exitCode, 1);
  assert.equal(existsSync(join(out, "nope.zip")), false);
});

test("refuses to export a quarantined skill", async () => {
  await seed("tainted", { quarantined: true });
  const out = freshOut();
  await runExport(["@me/tainted"], out);
  assert.equal(process.exitCode, 1);
  assert.equal(existsSync(join(out, "tainted.zip")), false);
});

test("exports a kit as one archive with owner--slug subdirs, skipping quarantined", async () => {
  await seed("ops-a", { owner: "taylor", sourceKit: "@taylor/ops" });
  await seed("ops-b", { owner: "taylor", sourceKit: "@taylor/ops" });
  await seed("ops-bad", { owner: "taylor", sourceKit: "@taylor/ops", quarantined: true });
  const out = freshOut();
  await runExport(["--kit", "ops"], out);
  const files = unzipSync(readFileSync(join(out, "ops.zip")));
  assert.deepEqual(Object.keys(files).sort(), [
    "taylor--ops-a/SKILL.md",
    "taylor--ops-b/SKILL.md",
  ]);
});

test("owner-qualified --kit @owner/name matches exactly", async () => {
  await seed("q-a", { owner: "taylor", sourceKit: "@taylor/qkit" });
  const out = freshOut();
  await runExport(["--kit", "@taylor/qkit"], out);
  const files = unzipSync(readFileSync(join(out, "qkit.zip")));
  assert.deepEqual(Object.keys(files), ["taylor--q-a/SKILL.md"]);
});

test("no ref and no --kit is a usage error (exit 1, nothing written)", async () => {
  const out = freshOut();
  await runExport([], out);
  assert.equal(process.exitCode, 1);
  assert.equal(readdirSync(out).length, 0);
});

test("a kit where every skill is quarantined exits 1 with nothing written", async () => {
  await seed("all-bad-a", { owner: "taylor", sourceKit: "@taylor/allbad", quarantined: true });
  await seed("all-bad-b", { owner: "taylor", sourceKit: "@taylor/allbad", quarantined: true });
  const out = freshOut();
  await runExport(["--kit", "allbad"], out);
  assert.equal(process.exitCode, 1);
  assert.equal(existsSync(join(out, "allbad.zip")), false);
});

test("a skill present in state but missing its bytes fails cleanly (exit 1, no crash)", async () => {
  await seedStateOnly("ghost");
  const out = freshOut();
  await runExport(["@me/ghost"], out);
  assert.equal(process.exitCode, 1);
  assert.equal(existsSync(join(out, "ghost.zip")), false);
});

test("readable store bytes that drifted from the recorded hash refuse to export (exit 1)", async () => {
  await seed("drifty");
  writeFileSync(
    join(TEST_ROOT, ".skillet", "skills", "drifty", "SKILL.md"),
    skillMd("drifty") + "\ntampered",
  );
  const out = freshOut();
  await runExport(["drifty"], out);
  assert.equal(process.exitCode, 1);
  assert.equal(existsSync(join(out, "drifty.zip")), false);
});
