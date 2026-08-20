// Customized skills — the machinery behind "editing a synced skill makes it
// yours." When a user (or their agent) edits a materialized skill, sync marks
// the entry `customized_from` and LEAVES THE EDIT LIVE (never reverted). The
// author's updates for it are HELD, surfaced quietly, and reconciled on demand:
//   - takeUpstream(slug)   — replace the edit with the author's version
//   - restoreOriginal(slug)— replace the edit with the current signed version
//   - keepMine(slug)       — acknowledge a held update so it stops nudging
//   - proposeCustomized     — send the edit upstream (see propose.ts)
//
// The leaf helpers this file relies on (the backup store, drift detection, the
// run-dir conventions) live in ./edits-store.js — a module that imports NOTHING
// from ./sync.js. Keeping them there breaks the edits↔sync ESM cycle that used
// to fault on `LEDGER_STAMP` during init. This file keeps only the reconcile
// actions, which DO need `verifyForMaterialize` from ./sync.js.
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { canonicalContentHash, type DecodedBundle } from '@skillet/protocol'
import { defaultPinDir } from '../signing/pin.js'
import {
  readState,
  writeState,
  readBundleFromSkillStore,
} from '../kit/store.js'
import { verifyForMaterialize } from './sync.js'
import { recordEvent, detectInitiator } from '../metrics.js'
import type { Adapter } from '../adapter.js'
import type { SkillEntry } from '../kit/types.js'
import {
  readTreeIgnoringDotfiles,
  backupSkillVersion,
  readBaselineStash,
  clearBaselineStash,
  detectStoreDrift,
  detectDriftedGlobalCopies,
  type DriftedCopy,
  type BackupReason,
  type SkillLineage,
} from './edits-store.js'

// Backward-compatible re-exports: these leaf helpers moved to ./edits-store.js
// (breaking the edits↔sync import cycle) but stay reachable via this module for
// existing importers and the curated public surface.
export {
  editsRoot,
  listBackups,
  ledgerStamp,
  writeRunManifest,
  moveDir,
  detectDriftedGlobalCopies,
  LEDGER_STAMP,
} from './edits-store.js'
export type {
  SkillLineage,
  DriftedCopy,
  UncapturableCopy,
  DriftDetection,
  BackupReason,
  BackupManifest,
  BackupEntry,
} from './edits-store.js'

/**
 * Strip the `@owner/` canonical prefix before passing to adapter APIs.
 * Adapters receive `(bareSlug, { owner })` separately — they must not see
 * the `@` or `/` chars that assertSafeSlug rejects. (Mirrors sync.ts.)
 */
function bareAdapterSlug(slug: string, owner: string | null): string {
  if (owner && slug.startsWith('@')) {
    const idx = slug.indexOf('/')
    if (idx >= 0) return slug.slice(idx + 1)
  }
  return slug
}

// ── lineage ─────────────────────────────────────────────────────────────────

/** The lineage as a human/registry ref: `@author/slug` for registry origins, the bare slug for local ones. */
export function lineageRef(lineage: SkillLineage): string {
  if (!lineage.author) return lineage.slug
  return lineage.slug.startsWith('@') ? lineage.slug : `@${lineage.author}/${lineage.slug}`
}

/**
 * Registry propose target for a lineage, or null when the origin is local-only
 * (nothing upstream to propose to).
 */
export function lineageTarget(lineage: SkillLineage): { author: string; slug: string } | null {
  if (!lineage.author) return null
  return { author: lineage.author, slug: bareAdapterSlug(lineage.slug, lineage.author) }
}

/**
 * The first readable global adapter copy of a skill, as a bundle tree. Used to
 * build a propose bundle from the LIVE on-disk edit. Null when no global copy
 * is present/readable.
 */
export async function readLiveCustomizedTree(
  slug: string,
  owner: string | null,
  adapters: Adapter[],
): Promise<Map<string, Buffer> | null> {
  const adapterSlug = bareAdapterSlug(slug, owner)
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    let dir: string
    try {
      dir = adapter.targetSkillDir(adapterSlug, { owner })
    } catch {
      continue
    }
    try {
      const tree = await readTreeIgnoringDotfiles(dir)
      if (tree.size > 0) return tree
    } catch {
      continue
    }
  }
  return null
}

// ── customized-skill listing ──────────────────────────────────────────────────

export interface CustomizedSkill {
  slug: string
  entry: SkillEntry
  /** The lineage baseline the edit was made against. */
  lineage: SkillLineage
  /** A held author update is waiting AND has not been acknowledged (Keep mine). */
  hasUpdate: boolean
  /** The held update itself, when one exists (regardless of acknowledgement). */
  held?: { version: number; hash: string }
}

/** Every customized skill in kit state, flagging which have a held author update. */
export async function listCustomized(): Promise<CustomizedSkill[]> {
  const state = await readState()
  const out: CustomizedSkill[] = []
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (!entry.customized_from) continue
    const held = entry.held_update
    out.push({
      slug,
      entry,
      lineage: entry.customized_from,
      // A yanked held update never nudges — the author pulled it (F6).
      hasUpdate: !!held && !held.acknowledged && !held.yanked,
      ...(held ? { held: { version: held.version, hash: held.hash } } : {}),
    })
  }
  return out
}

// ── read-only live-edit scan (tray-open surfacing) ────────────────────────────

export interface LiveEdit {
  /** State key (`@owner/slug`). */
  slug: string
  /** Where the divergence was found. */
  where: 'store' | 'adapter'
}

/**
 * A READ-ONLY scan for UNPERSISTED local edits — synced skills whose store or
 * adapter bytes have drifted from the materialized baseline but which a full
 * sync has not yet reconciled into `customized_from`. This is what lets the
 * desktop tray surface "Edited locally" on tray-open, before the next full sync,
 * WITHOUT mutating state or disk (KTD5). Already-customized skills are excluded —
 * {@link listCustomized} covers those from persisted state.
 *
 * Detection mirrors the sync reconcile loop but never writes: a store edit
 * (global) is measured against `materialized_hash` and must also differ from the
 * recorded version (so a pulled-but-unmaterialized author version is not
 * mistaken for an edit); an adapter edit (per-runtime) is only considered when
 * the skill is stable (`materialized_hash === hash`).
 */
export async function listLiveEdits(adapters: Adapter[]): Promise<LiveEdit[]> {
  const state = await readState()
  const out: LiveEdit[] = []
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (entry.customized_from) continue
    const baseline = entry.materialized_hash
    if (baseline == null) continue
    const owner = entry.owner ?? null

    const store = await detectStoreDrift(slug, baseline)
    if (store.drifted && !store.uncapturable && store.hash !== null && store.hash !== entry.hash) {
      out.push({ slug, where: 'store' })
      continue
    }

    // Adapter edits only count as a live edit when state and disk agree on the
    // baseline (stable) — same guard sync uses to avoid reading a pending
    // materialize as a user edit.
    if (baseline === entry.hash) {
      const adapterSlug = bareAdapterSlug(slug, owner)
      const drift = await detectDriftedGlobalCopies(adapters, adapterSlug, owner, baseline)
      if (drift.drifted.length > 0) {
        out.push({ slug, where: 'adapter' })
      }
    }
  }
  return out
}

// ── reconcile actions (take / restore / keep) ─────────────────────────────────

export type ReconcileErrorCode =
  | 'not_found'
  | 'not_customized'
  | 'integrity_failed'
  /** The user's edit could not be backed up, so the overwrite was refused (F2). */
  | 'backup_failed'
  /** No runtime accepted the author bytes — the edit is still live (F3). */
  | 'materialize_failed'
  /**
   * Some runtimes took the bytes, some failed — the succeeded ones were ROLLED
   * BACK to the edit and the skill stays customized (F3/RF3). No split disk.
   */
  | 'partial_failure'
  /**
   * A partial materialize failed AND rolling the succeeded runtimes back to the
   * edit also failed — the disk may now be split. Loud, unusual, needs a human.
   */
  | 'rollback_failed'
  /**
   * Restore original was asked for but the exact baseline the edit was made FROM
   * is no longer obtainable (no stash, store advanced) — the edit is left in
   * place rather than silently applying a different (current upstream) version.
   */
  | 'baseline_unavailable'
  /** The target upstream version was yanked by the author (F6). */
  | 'yanked'

export class ReconcileError extends Error {
  readonly code: ReconcileErrorCode
  constructor(message: string, code: ReconcileErrorCode) {
    super(message)
    this.name = 'ReconcileError'
    this.code = code
  }
}

export interface ReconcileResult {
  slug: string
  /** Destination paths the author bytes were materialized into. */
  materialized: string[]
  /** Backup entry holding the user's replaced version, or null when nothing was on disk. */
  backupId: string | null
  /**
   * Reserved for a non-fatal note about the reconcile. No longer set for the
   * baseline-unobtainable case (RF4 now ABORTS there rather than silently
   * applying a different version), but kept on the surface for forward use.
   */
  note?: string
}

export interface ReconcileOptions {
  /** TOFU pinned-keys directory (defaults to $XDG_CONFIG_HOME/skillet/pinned). */
  pinDir?: string
}

/** A live global adapter copy captured for backup + rollback: its dir and the
 * exact on-disk edit tree (read once, reused so backup and rollback can't
 * disagree). */
interface LiveCopy extends DriftedCopy {
  tree: Map<string, Buffer>
}

/**
 * Every readable global adapter copy of a skill currently on disk, each with its
 * edit tree captured. `unreadable` is set when a PRESENT (non-symlink) dir could
 * not be stat'd or read (RF6): distinct from ABSENT. The caller must abort the
 * reconcile on `unreadable` — materializing over a present-but-unreadable copy
 * would overwrite an edit that was never backed up.
 */
async function currentGlobalCopies(
  adapters: Adapter[],
  adapterSlug: string,
  owner: string | null,
): Promise<{ copies: LiveCopy[]; unreadable: boolean }> {
  const copies: LiveCopy[] = []
  let unreadable = false
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    let dir: string
    try {
      dir = adapter.targetSkillDir(adapterSlug, { owner })
    } catch {
      continue
    }
    let st
    try {
      st = await lstat(dir)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      // Absent → nothing to back up. Anything else (EACCES, EIO…) → a dir may be
      // there that we cannot even inspect: present-but-unreadable, never clean.
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      unreadable = true
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue
    let tree: Map<string, Buffer>
    try {
      tree = await readTreeIgnoringDotfiles(dir)
    } catch {
      unreadable = true // present but unreadable → the caller aborts (RF6)
      continue
    }
    if (tree.size > 0) copies.push({ adapter: adapter.name, dir, tree })
  }
  return { copies, unreadable }
}

/**
 * Resolve the AUTHOR baseline a customized skill was edited from — the bytes at
 * `customized_from.hash` (F5). Prefers the content-addressed baseline stash
 * written at first-customize; falls back to the live store when it still holds
 * those exact bytes (no update pulled). Returns null when the baseline is no
 * longer obtainable — the caller then falls back to the current upstream.
 */
async function resolveBaselineBundle(
  slug: string,
  baselineHash: string,
): Promise<DecodedBundle | null> {
  const stashed = await readBaselineStash(baselineHash)
  if (stashed && canonicalContentHash(stashed) === baselineHash) {
    return stashed as unknown as DecodedBundle
  }
  try {
    const store = await readBundleFromSkillStore(slug)
    if (canonicalContentHash(store) === baselineHash) return store
  } catch {
    // No readable store bytes — the baseline is unobtainable.
  }
  return null
}

/**
 * Shared core of Take theirs / Restore original: verify the target bytes,
 * back up the user's current on-disk edit, materialize the target over it, and
 * clear `customized_from` / `held_update`.
 *
 * `target` selects which author version is applied:
 *  - 'upstream'  → the current signed version in the store (full signature gate).
 *  - 'baseline'  → the version the edit was made FROM (`customized_from.hash`),
 *                  from our trusted local snapshot, integrity-gated by content
 *                  hash; ABORTS (baseline_unavailable) when unobtainable rather
 *                  than substituting a different (current upstream) version (RF4).
 *
 * Verify runs BEFORE the backup and the overwrite (an author version that does
 * not check aborts with the edit left live — KTD6). The backup runs BEFORE the
 * overwrite and its failure ABORTS (F2 — never destroy the only copy of the
 * edit). The customized markers are cleared ONLY when EVERY global adapter took
 * the bytes; total/partial materialize failure keeps the skill customized (F3).
 */
async function applyAuthorVersion(
  slug: string,
  adapters: Adapter[],
  opts: ReconcileOptions,
  reason: BackupReason,
  target: 'upstream' | 'baseline',
): Promise<ReconcileResult> {
  const state = await readState()
  const entry = state.skills[slug]
  if (!entry) throw new ReconcileError(`No skill "${slug}" in kit state.`, 'not_found')
  if (!entry.customized_from) {
    throw new ReconcileError(`Skill "${slug}" is not customized.`, 'not_customized')
  }
  const owner = entry.owner ?? null
  const pinDir = opts.pinDir ?? defaultPinDir()

  // F6: never install a version the author has YANKED. Take theirs refuses when
  // the held update it would install is flagged yanked (Restore original is
  // fine — restoring the baseline never resurrects the withdrawn version).
  if (target === 'upstream' && entry.held_update?.yanked && entry.held_update.hash === entry.hash) {
    throw new ReconcileError(
      `The upstream version of "${slug}" was yanked by the author — not installing it. Your edit was left in place.`,
      'yanked',
    )
  }

  // Resolve + verify the bytes to materialize (KTD6). Only the user's own edited
  // bytes ever live unsigned on disk; every author version passes a verify gate.
  let bundle: DecodedBundle
  let hash: string
  if (target === 'baseline') {
    const baseline = entry.customized_from
    const resolved = await resolveBaselineBundle(slug, baseline.hash)
    // RF4: "Restore original" means the exact version the edit was made FROM. If
    // that baseline is unobtainable (no stash, and the store has since advanced
    // past it), ABORT — never silently apply the CURRENT upstream in its place
    // (a different version, and one that would bypass the yanked guard, which is
    // gated on target === 'upstream'). The edit is left live; Take theirs is the
    // deliberate way to move to the current version.
    if (!resolved) {
      throw new ReconcileError(
        `Cannot restore the original v${baseline.version} of "${slug}" — the version you edited from is no longer available. Your edit is left in place; use "Take theirs" to move to the current version.`,
        'baseline_unavailable',
      )
    }
    bundle = resolved
    hash = canonicalContentHash(bundle)
    // Integrity gate: the local snapshot must hash to the recorded lineage hash
    // (its author signature was already verified when first materialized). Reuse
    // verifyForMaterialize via a synthetic local entry so both paths are gated.
    const verifyEntry: SkillEntry = { ...entry, source: 'local', hash: baseline.hash }
    const failure = await verifyForMaterialize(verifyEntry, hash, pinDir)
    if (failure !== null) {
      throw new ReconcileError(
        `Cannot restore the original version of "${slug}": ${failure}. Your edit was left in place.`,
        'integrity_failed',
      )
    }
  } else {
    bundle = await readBundleFromSkillStore(slug)
    hash = canonicalContentHash(bundle)
    const failure = await verifyForMaterialize(entry, hash, pinDir)
    if (failure !== null) {
      throw new ReconcileError(
        `Cannot apply the author version of "${slug}": ${failure}. Your edit was left in place.`,
        'integrity_failed',
      )
    }
  }

  // Back up the user's current on-disk edit before anything overwrites it.
  // F2: when a live copy exists but the backup could not be written, ABORT —
  // overwriting would destroy the only copy of the user's edit. Proceed without
  // a backup only when there is genuinely no readable copy on disk.
  const adapterSlug = bareAdapterSlug(slug, owner)
  const { copies, unreadable } = await currentGlobalCopies(adapters, adapterSlug, owner)
  // RF6: a PRESENT-but-unreadable copy holds an edit we cannot capture. Overwriting
  // it would destroy an un-backed-up edit — abort, exactly as a failed backup does.
  if (unreadable) {
    throw new ReconcileError(
      `Cannot apply the author version of "${slug}": an on-disk copy could not be read to back it up, so it was left in place. Retry once it is readable.`,
      'backup_failed',
    )
  }
  const copiesByDir = new Map(copies.map((c) => [c.dir, c] as const))
  let backupId: string | null = null
  if (copies.length > 0) {
    try {
      backupId = (
        await backupSkillVersion({
          lineage: { ...entry.customized_from },
          copies: copies.map((c) => ({ adapter: c.adapter, dir: c.dir })),
          reason,
        })
      ).backupId
    } catch {
      // Fall through with backupId still null — the guard below aborts.
    }
    if (backupId === null) {
      throw new ReconcileError(
        `Cannot apply the author version of "${slug}": backing up your current edit failed, so it was left in place. Retry once the backup location is writable.`,
        'backup_failed',
      )
    }
  }

  // Materialize the verified bytes over the edit. RF3: take/restore is ALL-OR-
  // NOTHING. Track per-adapter outcomes; on a PARTIAL failure roll the succeeded
  // runtimes back to the user's edit (from the captured copy) so the edit stays
  // live on EVERY runtime and the state is left customized — never a split disk
  // (one runtime upstream, one edit). A total failure needs no rollback (nothing
  // was overwritten). Only when every runtime takes the bytes do we clear state.
  const materialized: string[] = []
  const applied: Array<{ dir: string; edit: Map<string, Buffer> | null }> = []
  let attempted = 0
  let succeeded = 0
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    attempted += 1
    let dir: string | null = null
    try {
      dir = adapter.targetSkillDir(adapterSlug, { owner })
    } catch {
      dir = null
    }
    try {
      const written = await adapter.materialize(adapterSlug, bundle, { owner })
      materialized.push(...written)
      succeeded += 1
      // Remember what to undo if a LATER adapter fails: the captured edit tree
      // for this dir (restore it), or null when this runtime had no prior copy
      // (remove what we just wrote — the edit never lived here).
      if (dir !== null) applied.push({ dir, edit: copiesByDir.get(dir)?.tree ?? null })
    } catch {
      // Degrade-never-delete: keep going; the rollback/throw below handles it.
    }
  }

  if (attempted > 0 && succeeded === 0) {
    throw new ReconcileError(
      `Could not apply the author version of "${slug}": no agent accepted the write, so your edit is still live${backupId ? ` (backed up as ${backupId})` : ''}.`,
      'materialize_failed',
    )
  }
  if (succeeded < attempted) {
    // RF3 rollback: restore the edit to every runtime we already wrote author
    // bytes to, so no runtime is left on the author version. State is untouched
    // (still customized) below by throwing before the clear.
    try {
      await rollbackApplied(applied)
    } catch (err) {
      throw new ReconcileError(
        `Applied the author version of "${slug}" to ${succeeded}/${attempted} agents, then failed to roll the rest back; the disk may be split. Restore your edit from the backup${backupId ? ` (${backupId})` : ''}: ${(err as Error).message}`,
        'rollback_failed',
      )
    }
    throw new ReconcileError(
      `Could not apply the author version of "${slug}" to every agent (${succeeded}/${attempted}); rolled your edit back everywhere, so it stays live and customized. Re-run once all agents are writable${backupId ? ` (your edit is backed up as ${backupId})` : ''}.`,
      'partial_failure',
    )
  }

  // Every adapter took the bytes — clear the customized state.
  const now = new Date().toISOString()
  const baselineHash = entry.customized_from.hash
  const updated: SkillEntry = { ...entry, hash, materialized_hash: hash, updatedAt: now }
  delete updated.customized_from
  delete updated.held_update
  state.skills[slug] = updated
  await writeState(state)
  // RF8: the skill is no longer customized — drop its baseline stash so the
  // content-addressed baselines store doesn't accumulate forever.
  await clearBaselineStash(baselineHash)

  recordEvent(reason === 'take-upstream' ? 'skill.take' : 'skill.restore', detectInitiator(), {
    slug,
  })
  return { slug, materialized, backupId }
}

/**
 * Undo a partial materialize (RF3): for each runtime we wrote author bytes to,
 * clear the dir and rewrite the user's captured edit tree — or, when that runtime
 * had no prior copy, remove the freshly written dir. Restores the pre-reconcile
 * disk state so the edit is live everywhere it was. Throws if any step fails
 * (the caller surfaces that as `rollback_failed`).
 */
async function rollbackApplied(
  applied: Array<{ dir: string; edit: Map<string, Buffer> | null }>,
): Promise<void> {
  for (const { dir, edit } of applied) {
    await rm(dir, { recursive: true, force: true })
    if (!edit) continue // no prior copy → leaving it removed matches the pre-state
    for (const [rel, bytes] of edit) {
      const dest = join(dir, ...rel.split('/'))
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, bytes)
    }
  }
}

/**
 * Take theirs: back up the user's version and materialize the current UPSTREAM
 * bytes, clearing the customized state. The upstream bytes are the ones sync
 * already pulled into the skill store (available at reconcile time — no separate
 * held-bytes stash). Refuses when the upstream version was yanked (F6).
 */
export async function takeUpstream(
  slug: string,
  adapters: Adapter[],
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  return applyAuthorVersion(slug, adapters, opts, 'take-upstream', 'upstream')
}

/**
 * Restore original: back up the user's version and materialize the BASELINE the
 * edit was made from (`customized_from`) — the version the user edited FROM,
 * distinct from the current/held upstream (F5). ABORTS (baseline_unavailable,
 * edit left live) when that baseline is no longer obtainable — never substitutes
 * the current upstream (RF4).
 */
export async function restoreOriginal(
  slug: string,
  adapters: Adapter[],
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  return applyAuthorVersion(slug, adapters, opts, 'restore-original', 'baseline')
}

/**
 * Keep mine: acknowledge a held update so it stops surfacing until a NEWER
 * upstream hash appears (which replaces the record, clearing the flag). A no-op
 * when there is no unacknowledged held update. Returns the entry.
 */
export async function keepMine(slug: string): Promise<SkillEntry> {
  const state = await readState()
  const entry = state.skills[slug]
  if (!entry) throw new ReconcileError(`No skill "${slug}" in kit state.`, 'not_found')
  if (entry.held_update && !entry.held_update.acknowledged) {
    entry.held_update = { ...entry.held_update, acknowledged: true }
    entry.updatedAt = new Date().toISOString()
    await writeState(state)
  }
  return entry
}
