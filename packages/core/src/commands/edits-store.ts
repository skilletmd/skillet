// Leaf helpers for the customized-skills machinery — the pieces that do NOT
// depend on sync.ts. Extracting them here breaks the two-way ESM cycle between
// edits.ts (which imports `verifyForMaterialize` from sync.ts) and sync.ts /
// restore.ts (which need these leaf helpers): during module init the cycle used
// to reach edits.ts's top-level `export const LEDGER_STAMP` before it was
// initialized (a TDZ ReferenceError). This module imports NOTHING from sync.ts,
// so it initializes cleanly and both sides depend on it one-directionally.
//
// The `~/.skillet/edits/` dir is a BACKUP STORE: the user's version is snapshot
// there on first customize and again before any Take theirs / Restore original
// replaces it, so a replaced edit is always recoverable. It has NO TTL and is
// deliberately separate from `~/.skillet/trash` (a 30-day sweep target): the
// edits store is user work a trash-emptying tool must never eat.
import { readdir, readFile, writeFile, lstat, mkdir, rename, rm, cp } from 'node:fs/promises'
import { join, relative, sep, basename, dirname } from 'node:path'
import { canonicalContentHash } from '@skillet/protocol'
import { skilletDir } from '../session-token.js'
import { skillContentDir } from '../kit/store.js'
import { atomicWrite } from '../util/atomic.js'
import { isTccParkedPath } from '../util/tcc-access.js'
import type { Adapter } from '../adapter.js'

// ── shared run-dir conventions (trash + edits) ──────────────────────────────

/** A unique run-dir name, shared by the trash and edits ledgers. */
export function ledgerStamp(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
}

/** Matches ledgerStamp() output — listing/clearing never reaches a foreign dir. */
export const LEDGER_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}$/

/** Write a run's `manifest.json`, creating the run dir. */
export async function writeRunManifest(
  runDir: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

/**
 * Move a dir, preferring an atomic rename and falling back to copy+remove
 * across filesystems (EXDEV). Shared by the prune trash pass and restore.
 * Returns true on success.
 *
 * Success means THE BYTES ARE IN THE DESTINATION. When the fallback copy
 * succeeded but removing the source failed, that is still a success — the
 * leftover source is reported best-effort via `opts.onLeftover`, never by
 * failing the move (a false failure here would make callers treat preserved
 * bytes as lost).
 */
export async function moveDir(
  from: string,
  to: string,
  opts: { onLeftover?: (src: string) => void } = {},
): Promise<boolean> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
    return true
  } catch {
    try {
      await cp(from, to, { recursive: true })
    } catch {
      return false
    }
    try {
      await rm(from, { recursive: true, force: true })
    } catch {
      opts.onLeftover?.(from)
    }
    return true
  }
}

// ── lineage ─────────────────────────────────────────────────────────────────

/** The signed author origin a customized skill's edit was made against. */
export interface SkillLineage {
  author: string | null
  slug: string
  version: number
  hash: string
}

export function editsRoot(): string {
  return join(skilletDir(), 'edits')
}

// ── baseline stash (Restore original) ─────────────────────────────────────────

/**
 * Content-addressed store of the AUTHOR baseline a customized skill was edited
 * from — the bytes at `customized_from.hash`. Snapshotted at first-customize
 * (while the skill store still holds those bytes, before any pull overwrites
 * them) so "Restore original" can return the version the edit was made FROM
 * even after an author update is pulled — the case that makes restoreOriginal
 * meaningfully distinct from takeUpstream (F5). Keyed by hash → self-dedup, no
 * TTL; a trash sweep must never eat it (it lives under `~/.skillet/baselines`).
 */
export function baselinesRoot(): string {
  return join(skilletDir(), 'baselines')
}

function baselineDir(hash: string): string {
  // `sha256:<hex>` → a filesystem-safe dir name. Content-addressed: the same
  // baseline hash always maps to the same dir, so re-stashing is idempotent.
  return join(baselinesRoot(), hash.replace(/[^a-zA-Z0-9]/g, '_'))
}

/**
 * Snapshot a baseline bundle under its content hash. Idempotent by hash.
 * Each file is written atomically (temp + rename, F7): a torn write leaves a
 * half-written stash that `readBaselineStash` would otherwise trust — the atomic
 * write plus the read-side hash validation together reject any partial snapshot.
 */
export async function stashBaselineVersion(
  hash: string,
  bundle: Map<string, Buffer>,
): Promise<void> {
  const dir = baselineDir(hash)
  await mkdir(dir, { recursive: true })
  for (const [rel, bytes] of bundle) {
    const dest = join(dir, ...rel.split('/'))
    await atomicWrite(dest, bytes, { backup: false })
  }
}

/**
 * Read a stashed baseline bundle by hash, or null when none is stored OR the
 * stashed bytes do not hash to `hash` (F7): a torn/partial stash never round-
 * trips through canonicalContentHash, so a caller only ever gets a verified-
 * complete baseline back — never half of one.
 */
export async function readBaselineStash(hash: string): Promise<Map<string, Buffer> | null> {
  try {
    const tree = await readTreeIgnoringDotfiles(baselineDir(hash))
    if (tree.size === 0) return null
    if (canonicalContentHash(tree) !== hash) return null
    return tree
  } catch {
    return null
  }
}

/** Delete a skill's stashed baseline (F8: bound the stash — drop it once the
 * skill is un-customized or its entry is localized/removed). Best-effort. */
export async function clearBaselineStash(hash: string): Promise<void> {
  try {
    await rm(baselineDir(hash), { recursive: true, force: true })
  } catch {
    // Best-effort disk hygiene — a failed cleanup never blocks the caller.
  }
}

// ── dotfile-tolerant read ────────────────────────────────────────────────────

/**
 * Read a materialized skill dir, ignoring dot-prefixed names (AE7): a
 * `.DS_Store` must never make the drift read throw — that would turn detection
 * off. Symlinks and non-regular files are skipped, never followed. The SAME
 * tree feeds detection hashing and backup copying, so the two cannot disagree.
 */
export async function readTreeIgnoringDotfiles(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  await walkIgnoringDotfiles(dir, dir, out)
  return out
}

async function walkIgnoringDotfiles(
  root: string,
  dir: string,
  out: Map<string, Buffer>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.endsWith('.skillet-backup')) continue
    const absPath = join(dir, entry.name)
    const st = await lstat(absPath)
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) {
      await walkIgnoringDotfiles(root, absPath, out)
    } else if (st.isFile()) {
      const rel = relative(root, absPath)
      out.set(sep === '/' ? rel : rel.split(sep).join('/'), await readFile(absPath))
    }
  }
}

// ── drift detection ──────────────────────────────────────────────────────────

export interface DriftedCopy {
  adapter: string
  dir: string
}

/** An EXISTING dir whose tree could not be read or hashed — possibly edited, but unreadable. */
export interface UncapturableCopy extends DriftedCopy {
  /** errno-style code from the failed read/hash, when available. */
  code: string | null
}

export interface DriftDetection {
  drifted: DriftedCopy[]
  /**
   * Existing, non-symlink dirs we could not read or hash. These are NOT clean:
   * they may hold an edit we cannot prove absent. Callers MUST NOT materialize
   * over them (never overwrite a possibly-edited dir uncaptured).
   */
  uncapturable: UncapturableCopy[]
  /**
   * Roots that RESOLVE into a macOS TCC-protected folder (U2): not inspected
   * at all — no lstat, no read. Distinct from `uncapturable`: a parked root is
   * not an error and MUST NOT surface per-skill `edit_unreadable` failures,
   * and whatever bytes sit there must never be classified as a hand edit.
   * Callers keep the copy accounted for (never prune/absent) and skip
   * reads/writes against it until the root is readable again.
   */
  parked: DriftedCopy[]
}

function errnoCode(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : null
}

/**
 * Find EVERY global adapter copy of a synced skill whose on-disk bytes drifted
 * from `baselineHash` — the hash sync last wrote. Project adapters and symlinked
 * dirs are skipped, as is a MISSING dir (nothing on disk). An existing dir we
 * cannot read or hash is returned as `uncapturable` — never silently clean.
 */
export async function detectDriftedGlobalCopies(
  adapters: Adapter[],
  adapterSlug: string,
  owner: string | null,
  baselineHash: string,
): Promise<DriftDetection> {
  const drifted: DriftedCopy[] = []
  const uncapturable: UncapturableCopy[] = []
  const parked: DriftedCopy[] = []
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    let dir: string
    try {
      dir = adapter.targetSkillDir(adapterSlug, { owner })
    } catch {
      continue
    }
    // TCC policy gate (U2/U3) BEFORE any filesystem touch (even lstat inside
    // a protected folder can trip the consent prompt): a parked root is not
    // drifted and not an error — it simply cannot be inspected this run.
    if (isTccParkedPath(dir)) {
      parked.push({ adapter: adapter.name, dir })
      continue
    }
    let st
    try {
      st = await lstat(dir)
    } catch (err) {
      const code = errnoCode(err)
      // Missing target → nothing on disk. Anything else (EACCES, EIO…) means a
      // dir may exist that we cannot even inspect — uncapturable.
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      uncapturable.push({ adapter: adapter.name, dir, code })
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue
    let tree: Map<string, Buffer>
    try {
      tree = await readTreeIgnoringDotfiles(dir)
    } catch (err) {
      uncapturable.push({ adapter: adapter.name, dir, code: errnoCode(err) })
      continue
    }
    if (tree.size === 0) continue
    let hash: string
    try {
      hash = canonicalContentHash(tree)
    } catch (err) {
      uncapturable.push({ adapter: adapter.name, dir, code: errnoCode(err) })
      continue
    }
    if (hash !== baselineHash) drifted.push({ adapter: adapter.name, dir })
  }
  return { drifted, uncapturable, parked }
}

/** Result of hashing the local skill STORE copy against a baseline. */
export interface StoreDriftDetection {
  /** The store bytes exist, are readable, and hash differently from the baseline. */
  drifted: boolean
  /**
   * The captured store tree when it was readable — reused by the caller for
   * backup/stash so detection hashing and the snapshot cannot disagree. Null
   * when the store dir is missing, empty, a symlink, or uncapturable.
   */
  tree: Map<string, Buffer> | null
  /**
   * The store dir EXISTS but could not be read or hashed — a possible edit we
   * cannot prove absent. Like {@link DriftDetection.uncapturable}: callers MUST
   * NOT overwrite it uncaptured.
   */
  uncapturable: boolean
  /** errno-style code from the failed read/hash, when available. */
  code: string | null
  /** Canonical hash of the store copy when readable; null otherwise. */
  hash: string | null
  /**
   * The store dir resolves into a macOS TCC-protected folder (U2) and was NOT
   * inspected — no lstat, no read. Not an error and not drift: callers treat
   * the store as not-inspectable this run (no `edit_unreadable` failure, no
   * hand-edit classification, no store write over bytes we cannot see).
   */
  parked: boolean
}

/**
 * Hash a synced skill's local STORE copy (`~/.skillet/skills/<slug>`) against
 * `baselineHash` — the hash sync last materialized. A store edit is a GLOBAL
 * edit (it propagates to every runtime), unlike a per-runtime adapter edit.
 * Mirrors {@link detectDriftedGlobalCopies} semantics for the single store dir:
 * a MISSING or empty dir is not drift (nothing to preserve), a symlink is
 * skipped, and an existing dir we cannot read/hash is `uncapturable` — never
 * silently clean.
 */
export async function detectStoreDrift(
  slug: string,
  baselineHash: string,
): Promise<StoreDriftDetection> {
  const clean: StoreDriftDetection = {
    drifted: false,
    tree: null,
    uncapturable: false,
    code: null,
    hash: null,
    parked: false,
  }
  let dir: string
  try {
    dir = skillContentDir(slug)
  } catch {
    // A traversal/absolute slug can't name a store copy we own — treat as clean.
    return clean
  }
  // TCC policy gate (U2/U3) BEFORE any filesystem touch: a parked store is
  // not inspected at all this run.
  if (isTccParkedPath(dir)) {
    return { ...clean, parked: true }
  }
  let st
  try {
    st = await lstat(dir)
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return clean
    return { ...clean, uncapturable: true, code }
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return clean
  let tree: Map<string, Buffer>
  try {
    tree = await readTreeIgnoringDotfiles(dir)
  } catch (err) {
    return { ...clean, uncapturable: true, code: errnoCode(err) }
  }
  if (tree.size === 0) return clean
  let hash: string
  try {
    hash = canonicalContentHash(tree)
  } catch (err) {
    return { ...clean, uncapturable: true, code: errnoCode(err) }
  }
  return { drifted: hash !== baselineHash, tree, uncapturable: false, code: null, hash, parked: false }
}

// ── backup store ──────────────────────────────────────────────────────────────

export type BackupReason = 'customize' | 'take-upstream' | 'restore-original'

export interface BackupManifest {
  backup_id: string
  reason: BackupReason
  lineage: SkillLineage
  adapters: string[]
  original_paths: string[]
  tree_hash: string
  backed_up_at: string
}

export interface BackupEntry {
  id: string
  dir: string
  /** Manifest missing or corrupt — surfaced as an entry, never silently skipped. */
  unreadable: boolean
  manifest?: BackupManifest
}

/**
 * Snapshot a skill's on-disk copies into a new backup entry under
 * `~/.skillet/edits/<stamp>/<adapter>/<dirname>/` with a manifest. No
 * coalescing, no supersede chains — one snapshot per call, keyed by a fresh
 * stamp. Written on first customize and before Take theirs / Restore original,
 * so the replaced version is always recoverable. Throws only if the write fails.
 */
export async function backupSkillVersion(args: {
  lineage: SkillLineage
  copies: DriftedCopy[]
  reason: BackupReason
}): Promise<{ backupId: string }> {
  const copies = [...args.copies].sort((a, b) => a.adapter.localeCompare(b.adapter))
  const backupId = ledgerStamp()
  const backupDir = join(editsRoot(), backupId)
  const combined = new Map<string, Buffer>()
  const adapters: string[] = []
  const originalPaths: string[] = []
  for (const copy of copies) {
    const tree = await readTreeIgnoringDotfiles(copy.dir)
    const destRoot = join(backupDir, copy.adapter, basename(copy.dir))
    for (const [rel, bytes] of tree) {
      const dest = join(destRoot, ...rel.split('/'))
      // Atomic (temp + rename, F7): a torn backup write must never leave a
      // half-copy that a later recovery/restore trusts as the user's edit.
      await atomicWrite(dest, bytes, { backup: false })
      combined.set(`${copy.adapter}/${basename(copy.dir)}/${rel}`, bytes)
    }
    adapters.push(copy.adapter)
    originalPaths.push(copy.dir)
  }
  const manifest: BackupManifest = {
    backup_id: backupId,
    reason: args.reason,
    lineage: args.lineage,
    adapters,
    original_paths: originalPaths,
    tree_hash: canonicalContentHash(combined),
    backed_up_at: new Date().toISOString(),
  }
  await writeRunManifest(backupDir, manifest as unknown as Record<string, unknown>)
  return { backupId }
}

/** All backup entries, newest first. Unreadable manifests are surfaced, never skipped. */
export async function listBackups(): Promise<BackupEntry[]> {
  let entries
  try {
    entries = await readdir(editsRoot(), { withFileTypes: true })
  } catch {
    return []
  }
  const out: BackupEntry[] = []
  for (const e of entries) {
    if (!e.isDirectory() || !LEDGER_STAMP.test(e.name)) continue
    const dir = join(editsRoot(), e.name)
    try {
      const manifest = JSON.parse(
        await readFile(join(dir, 'manifest.json'), 'utf8'),
      ) as BackupManifest
      out.push({ id: e.name, dir, unreadable: false, manifest })
    } catch {
      out.push({ id: e.name, dir, unreadable: true })
    }
  }
  out.sort((a, b) => b.id.localeCompare(a.id)) // stamp is ISO-prefixed → lexical = chronological
  return out
}
