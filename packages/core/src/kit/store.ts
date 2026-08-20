import { readFile, mkdir, readdir, lstat, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import type { DecodedBundle } from "@skillet/protocol";
import { ARTIFACT_SCHEMA_VERSION, validateBundle, isSkilletBackupPath } from "@skillet/protocol";
import { atomicWrite } from "../util/atomic.js";
import { assertNoPathEscape } from "../util/pathsafe.js";
import { readBundleFromDir } from "../bundle/read.js";
import type { KitState, SkillEntry } from "./types.js";

export const SKILLET_DIR = process.env["SKILLET_DIR"] ?? join(homedir(), ".skillet");
const STATE_FILE = join(SKILLET_DIR, "state.json");

export async function readState(): Promise<KitState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as KitState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, artifact_schema_version: ARTIFACT_SCHEMA_VERSION, skills: {} };
    }
    throw err;
  }
}

export async function writeState(state: KitState): Promise<void> {
  await mkdir(SKILLET_DIR, { recursive: true });
  const stamped: KitState = {
    ...state,
    artifact_schema_version: state.artifact_schema_version ?? ARTIFACT_SCHEMA_VERSION,
  };
  await atomicWrite(STATE_FILE, JSON.stringify(stamped, null, 2) + "\n", { backup: false });
}

export async function upsertSkill(entry: SkillEntry): Promise<void> {
  const state = await readState();
  state.skills[entry.slug] = entry;
  await writeState(state);
}

/**
 * Whether the last post-sync device report carried a non-empty edited set.
 * Read-modify-write against the on-disk state so it never clobbers concurrent
 * per-skill upserts (mirrors {@link upsertSkill}). Drives the "clear edits by
 * absence" reconcile: see {@link KitState.edited_reported}.
 */
export async function readEditedReported(): Promise<boolean> {
  const state = await readState();
  return state.edited_reported === true;
}

export async function setEditedReported(reported: boolean): Promise<void> {
  const state = await readState();
  if (reported) state.edited_reported = true;
  else delete state.edited_reported;
  await writeState(state);
}

/**
 * README dropped at the STORE ROOT (`~/.skillet/skills/README.md`) so a person
 * who finds the folder (e.g. via the desktop viewer's "Folder" button) learns
 * that this is the editable copy and how an edit travels. It lives at the root,
 * OUTSIDE any `@owner/slug` skill dir, so it is never part of a bundle and never
 * materializes to a runtime.
 */
export const SKILL_STORE_README = `# Your Skillet skills

These folders are your synced skills, one per \`@owner/slug\`. This is the copy
Skillet keeps in sync across your coding agents.

## Editing a skill

Open a skill's \`SKILL.md\` here, make your changes, then run a sync (or just open
the Skillet app). Skillet detects the edit, keeps it as your version, and applies
it to every agent.

Your edit is safe. When the author ships an update, Skillet holds it for review
instead of overwriting your version. Review held updates on the Updates page.

Do not rename these folders or edit \`state.json\`. Skillet manages those.
`;

/**
 * Ensure the store-root README exists and is current. Best-effort, idempotent,
 * and cheap enough to call on every sync. Writes at the skills-dir root only,
 * never inside a skill bundle.
 */
export async function ensureSkillStoreReadme(): Promise<void> {
  const dir = join(SKILLET_DIR, "skills");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "README.md");
  try {
    if ((await readFile(path, "utf8")) === SKILL_STORE_README) return;
  } catch {
    // Missing or unreadable → (re)write below.
  }
  await atomicWrite(path, SKILL_STORE_README, { backup: false });
}

export function skillContentDir(slug: string): string {
  // Read-side chokepoint guard mirroring the write side (writeBundleToSkillStore).
  // Every read of a skill's bytes funnels through here; reject a traversal/absolute
  // slug (e.g. from a hand-edited state.json or a hostile registry response) before
  // it can escape the store root.
  assertNoPathEscape(join(SKILLET_DIR, "skills"), slug);
  return join(SKILLET_DIR, "skills", slug);
}

/**
 * Path to the skill's entrypoint `SKILL.md` in the local store. Bundle is
 * the directory; this is the canonical entry into it.
 */
export function skillContentPath(slug: string): string {
  return join(skillContentDir(slug), "SKILL.md");
}

/**
 * Persist a full bundle tree under the skill store.
 *
 * Removes anything previously in the skill dir so a republish/import that
 * deletes a file actually drops the file from disk (otherwise the next read
 * would still see the stale path and the hash would diverge from publish).
 */
export async function writeBundleToSkillStore(
  slug: string,
  bundle: DecodedBundle,
): Promise<void> {
  // SECURITY: a bundle's keys are attacker-controlled when it comes from the
  // registry (a hostile/compromised registry, or a session-attested envelope
  // that skips author crypto). Reject traversal/absolute/oversize entries here,
  // at the single store-write chokepoint, BEFORE any path is joined or written —
  // mirroring the materialize-side guard in bundle/write.ts. Without this a key
  // like `../../../.claude/skills/evil/SKILL.md` would escape the store.
  validateBundle(bundle);

  // SECURITY: validate the `slug` directory component too — it's registry/
  // manifest-derived for the pull callers. Every current caller guards it
  // upstream, but enforce it here so the chokepoint covers BOTH halves of a
  // write-what-where (the file path AND the directory prefix). Accepts both
  // `@author/slug` and bare local slugs; rejects `..`, absolute, and null-byte.
  assertNoPathEscape(join(SKILLET_DIR, "skills"), slug);

  const dir = skillContentDir(slug);
  await mkdir(dir, { recursive: true });
  await rmDirContents(dir);

  for (const [bundlePath, bytes] of bundle) {
    if (isSkilletBackupPath(bundlePath)) continue;
    const hostRel = sep === "/" ? bundlePath : bundlePath.split("/").join(sep);
    const dest = join(dir, hostRel);
    await atomicWrite(dest, Buffer.from(bytes), { backup: false });
  }
}

export async function readBundleFromSkillStore(
  slug: string,
  opts?: { includeSkilletBackups?: boolean },
): Promise<DecodedBundle> {
  return await readBundleFromDir(skillContentDir(slug), opts);
}

async function rmDirContents(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    const st = await lstat(abs);
    await rm(abs, { recursive: st.isDirectory(), force: true });
  }
}
