// `skillet restore` — bring back skills that a sync prune moved to trash, and
// age-clear old trash. Operates ONLY off the ledger each prune run writes
// (`~/.skillet/trash/<stamp>/manifest.json`); it never reconstructs paths
// heuristically, and it only ever touches dirs matching the prune stamp format.
import { readdir, readFile, rm, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { skilletDir } from '../session-token.js';
import { isSkilletSlugDirName } from '../bundle/write.js';
import { MATERIALIZATION_ROOT_ALLOWLIST } from '../util/pathsafe.js';
import { ledgerStamp, LEDGER_STAMP, writeRunManifest, moveDir } from './edits-store.js';
import { importSkill } from './import.js';

/** True iff `child` resolves to `root` or a path beneath it (symlink-safe). */
function withinRoot(child: string, root: string): boolean {
  let r: string;
  let c: string;
  try {
    r = realpathSync(root);
    c = realpathSync(child);
  } catch {
    r = resolve(root);
    c = resolve(child);
  }
  return c === r || c.startsWith(r + sep);
}

/**
 * The roots a restore is allowed to write into: the canonical adapter skills
 * roots, plus any in `SKILLET_SKILL_ROOTS` (colon-separated) for advanced setups
 * (a symlinked runtime dir) and sandboxed tests. Read at call time, never frozen.
 */
function restoreRoots(): string[] {
  const extra = (process.env['SKILLET_SKILL_ROOTS'] ?? '').split(/[:;]/).filter(Boolean);
  return [...MATERIALIZATION_ROOT_ALLOWLIST, ...extra];
}

/**
 * Restore destinations are trusted from a user-writable ledger, so they MUST be
 * confined to a real adapter skills root — otherwise a planted ledger turns
 * `skillet restore` into a write-what-where (move attacker bytes to ~/.ssh, an
 * autostart entry, a shell rc, …). Only paths inside an allowed root, with no
 * traversal/NUL, are eligible.
 */
function isRestorableDest(from: string): boolean {
  if (typeof from !== 'string' || from.includes('\0') || from.includes('..')) return false;
  return restoreRoots().some((root) => withinRoot(from, root));
}

interface TrashItem {
  slug: string;
  owner: string | null;
  hash: string;
  adapter: string;
  /** Original adapter path the bundle was moved FROM. */
  from: string;
  /** Trash path the bundle was moved TO. */
  to: string;
}
interface TrashLedger {
  trashedAt: string;
  /** Which producer wrote this run: 'prune' | 'sweep' | … (absent pre-kind). */
  kind?: string;
  items: TrashItem[];
}

export interface TrashRun {
  /** The trash dir name (the prune run stamp). */
  id: string;
  trashedAt: string;
  /** Distinct skill refs in this run. */
  skills: string[];
}

export interface RestoreResult {
  runId: string;
  /** Skill refs whose files were moved back to their adapter dirs. */
  restored: string[];
  /** Skill refs re-registered into local kit state. */
  reimported: string[];
  /** Items left untouched, with why (destination already exists, etc.). */
  skipped: Array<{ slug: string; reason: string }>;
}

// Matches the run stamp `2026-06-20T18-59-08-123Z-abc123` — never matches a
// foreign dir, so listing/clearing can't reach outside Skillet's own trash.
const TRASH_STAMP = LEDGER_STAMP;

function trashRoot(): string {
  return join(skilletDir(), 'trash');
}

async function readLedger(runDir: string): Promise<TrashLedger | null> {
  try {
    return JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as TrashLedger;
  } catch {
    return null;
  }
}

/** Existence check that does NOT follow symlinks — a symlink counts as present
 * (so we never move onto / through it). */
async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

// Dir moves share moveDir from ./edits-store.js (atomic rename, EXDEV copy+remove
// fallback) — one implementation, one set of semantics.

/** List restorable trash runs, newest first. */
export async function listTrash(): Promise<TrashRun[]> {
  let entries;
  try {
    entries = await readdir(trashRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: TrashRun[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !TRASH_STAMP.test(e.name)) continue;
    const ledger = await readLedger(join(trashRoot(), e.name));
    if (!ledger) continue;
    runs.push({
      id: e.name,
      trashedAt: ledger.trashedAt,
      skills: [...new Set(ledger.items.map((i) => i.slug))],
    });
  }
  runs.sort((a, b) => b.id.localeCompare(a.id)); // stamp is ISO-prefixed → lexical = chronological
  return runs;
}

/**
 * Restore a trash run (the newest when `runId` is omitted). Moves each ledger
 * item back to its original adapter path and re-registers it as a LOCAL skill
 * (a pruned skill is no longer subscribed). Never clobbers: an item whose
 * destination already exists is skipped. Idempotent — a second run is a no-op.
 * Returns null when there is nothing to restore.
 */
export async function restoreTrash(runId?: string): Promise<RestoreResult | null> {
  const runs = await listTrash();
  if (runs.length === 0) return null;
  const target = runId ? runs.find((r) => r.id === runId) : runs[0];
  if (!target) return null;
  const ledger = await readLedger(join(trashRoot(), target.id));
  if (!ledger) return null;

  const restored = new Set<string>();
  const skipped: RestoreResult['skipped'] = [];
  const dirBySlug = new Map<string, string>();
  const runDir = join(trashRoot(), target.id);

  for (const item of ledger.items) {
    // The ledger is user-writable: NEVER trust its paths as filesystem sinks.
    // The destination must be inside a real adapter skills root (blocks the
    // write-what-where), and the source must stay inside this trash run.
    if (!isRestorableDest(item.from)) {
      skipped.push({ slug: item.slug, reason: 'unsafe_destination' });
      continue;
    }
    if (typeof item.to !== 'string' || item.to.includes('\0') || !withinRoot(item.to, runDir)) {
      skipped.push({ slug: item.slug, reason: 'unsafe_source' });
      continue;
    }
    if (await exists(item.from)) {
      skipped.push({ slug: item.slug, reason: 'destination_exists' });
      continue;
    }
    if (!(await exists(item.to))) {
      skipped.push({ slug: item.slug, reason: 'trash_missing' });
      continue;
    }
    if (await moveDir(item.to, item.from)) {
      restored.add(item.slug);
      if (!dirBySlug.has(item.slug)) dirBySlug.set(item.slug, item.from);
    } else {
      skipped.push({ slug: item.slug, reason: 'move_failed' });
    }
  }

  // Re-register each restored skill as a local skill so it's tracked again and
  // won't be re-pruned. Files are back even if re-registration fails.
  const reimported: string[] = [];
  for (const [slug, dir] of dirBySlug) {
    try {
      await importSkill(dir, { force: true });
      reimported.push(slug);
    } catch {
      /* files restored; state re-registration best-effort */
    }
  }

  return { runId: target.id, restored: [...restored], reimported, skipped };
}

export interface SweepResult {
  /** Names of the Skillet-managed dirs moved to trash. */
  trashed: string[];
  /** Where they went (null when nothing matched). Restorable via `skillet restore`. */
  trashDir: string | null;
}

/**
 * Sweep Skillet-managed skill folders (`owner--slug` / `_local--slug`) out of an
 * arbitrary runtime root and into trash — the safe path to clean up after a
 * deprecated runtime adapter, when an account sync no longer scans that root.
 *
 * NEVER automatic: an explicit `skillet sweep <path>` only. A dir is swept only
 * if it BOTH matches Skillet's naming AND actually contains a `SKILL.md` (a real
 * bundle) — a name match alone (an unrelated `react--router` clone) is left
 * untouched. Symlinked entries are skipped. Reversible: moved to trash, never a
 * hard delete.
 */
export async function sweepOrphans(root: string): Promise<SweepResult> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { trashed: [], trashDir: null };
  }
  const managed: Array<{ name: string }> = [];
  for (const e of entries) {
    // Only a real Skillet bundle: managed name, a genuine directory (not a
    // symlink), with a SKILL.md inside. Name alone is not enough.
    if (e.isSymbolicLink() || !e.isDirectory() || !isSkilletSlugDirName(e.name)) continue;
    try {
      const inner = await readdir(join(root, e.name));
      if (!inner.includes('SKILL.md')) continue;
    } catch {
      continue;
    }
    managed.push({ name: e.name });
  }
  if (managed.length === 0) return { trashed: [], trashDir: null };

  const trashDir = join(trashRoot(), ledgerStamp());
  const trashed: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  for (const e of managed) {
    const from = join(root, e.name);
    const to = join(trashDir, 'sweep', e.name);
    if (await moveDir(from, to)) {
      trashed.push(e.name);
      items.push({ slug: e.name, owner: null, hash: '', adapter: 'sweep', from, to });
    }
  }
  if (items.length > 0) {
    await writeRunManifest(trashDir, {
      trashedAt: new Date().toISOString(),
      kind: 'sweep',
      items,
    });
  }
  return { trashed, trashDir: trashed.length > 0 ? trashDir : null };
}

/**
 * Remove trash runs older than `maxAgeDays`. Only touches dirs matching the
 * prune stamp with a parseable, old `trashedAt` — foreign dirs and recent runs
 * are never removed. Returns the count cleared. Best-effort; never throws.
 */
export async function clearOldTrash(maxAgeDays = 30, now = Date.now()): Promise<number> {
  let entries;
  try {
    entries = await readdir(trashRoot(), { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  let cleared = 0;
  for (const e of entries) {
    if (!e.isDirectory() || !TRASH_STAMP.test(e.name)) continue;
    const ledger = await readLedger(join(trashRoot(), e.name));
    const ts = ledger ? Date.parse(ledger.trashedAt) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) {
      try {
        await rm(join(trashRoot(), e.name), { recursive: true, force: true });
        cleared++;
      } catch {
        /* skip; best-effort */
      }
    }
  }
  return cleared;
}
