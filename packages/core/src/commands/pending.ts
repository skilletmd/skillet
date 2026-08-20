import { readFile, readdir, lstat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { canonicalContentHash } from '@skillet/protocol'
import { skilletDir } from '../session-token.js'
import { isTccParkedPath } from '../util/tcc-access.js'
import type { Adapter } from '../adapter.js'
import { readState, readBundleFromSkillStore } from '../kit/store.js'
import { skillStoreDirExists } from '../kit/store-integrity.js'
import { loadAuthorKey } from '../signing/index.js'
import {
  renderUpdateReview,
  checkLock,
  requiresQuarantineConsent,
  renderFindingsSummary,
  checkRejection,
  getLastApprovedVersion,
  defaultApprovalLockPath,
  loadPolicy,
} from '../trust/index.js'
import { accountClient } from '../registry/account-client.js'
import { requiresApproval, isAuthorPinned } from './sync.js'
import type { RegistryClient } from '../registry/client.js'

export interface PendingEntry {
  slug: string
  /** Hex-encoded Ed25519 author key ID, or null for locally-imported skills. */
  authorKeyId: string | null
  /** Last version approved in the approval lock, or null if never approved. */
  approvedVersion: number | null
  /**
   * Semver display label for `approvedVersion`. The approval lock records
   * integers only, so this stays undefined until a labeled source exists;
   * renderers fall back to the integer.
   */
  approvedVersionLabel?: string
  /** Current version in local state (the incoming update awaiting review). */
  incomingVersion: number
  /**
   * Semver display label for `incomingVersion`, persisted on the synced kit
   * entry by the registry pull. Undefined for entries synced from servers
   * predating labels; renderers fall back to the integer.
   */
  incomingVersionLabel?: string
  /**
   * Graded unified diff of the incoming bundle vs the most complete
   * materialized copy, rendered once with an applies-to header by
   * renderUpdateReview(). Empty string when no change is detectable
   * (e.g. no adapters materialized yet and bundle is new).
   */
  diff: string
  /** True when the harm scan quarantined this version — review surfaces must
   *  show `scanSummary` before any approve decision (informed consent). */
  quarantined: boolean
  /** Rendered harm-scan findings block for quarantined entries (counts +
   *  highlights, same detail as the sync-time gate), null when clean. */
  scanSummary: string | null
}

export interface PendingResult {
  pending: PendingEntry[]
}

export interface PendingOptions {
  /** Override the approval lock path (defaults to $XDG_DATA_HOME/skillet/skillet.lock). */
  approvalLockPath?: string
  /** Override the trust-policy path. */
  policyPath?: string
  /** Override $XDG_CONFIG_HOME for loading the user's own signing key. */
  configDir?: string
  /** Project root for project-scoped adapters (Cursor, Windsurf). */
  cwd?: string
  /** Injectable account client for tests; defaults to the configured bearer. */
  client?: RegistryClient | null
  /** Override the pinned-author-key directory (defaults under configDir). */
  pinDir?: string
}

function bareAdapterSlug(slug: string, owner: string | null): string {
  if (owner && slug.startsWith('@')) {
    const idx = slug.indexOf('/')
    if (idx >= 0) return slug.slice(idx + 1)
  }
  return slug
}

async function walkMaterialized(
  root: string,
  dir: string,
  adapterName: string,
  out: Record<string, Buffer>,
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absPath = join(dir, entry.name)
    let st
    try {
      st = await lstat(absPath)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      await walkMaterialized(root, absPath, adapterName, out)
    } else if (st.isFile()) {
      if (entry.name.endsWith('.skillet-backup')) continue
      const rel = relative(root, absPath)
      const posix = sep === '/' ? rel : rel.split(sep).join('/')
      out[`${adapterName}/${posix}`] = await readFile(absPath)
    }
  }
}

async function readCurrentMaterialized(
  slug: string,
  adapters: Adapter[],
  owner: string | null | undefined,
  cwd: string,
  parkedAdapterNames: ReadonlySet<string>,
): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {}
  for (const adapter of adapters) {
    if (adapter.kind === 'project' && !cwd) continue
    // TCC policy (U2): a global root resolving into a protected folder is
    // parked — unknown contents, never walked. The diff simply reflects the
    // readable runtimes. Parkedness is precomputed once per adapter root by
    // listPending (skill dirs live under adapter.targetDir), not re-derived
    // per skill.
    if (adapter.kind !== 'project' && parkedAdapterNames.has(adapter.name)) continue
    const skillDir = adapter.targetSkillDir(slug, { owner: owner ?? null, cwd })
    await walkMaterialized(skillDir, skillDir, adapter.name, result)
  }
  return result
}

/**
 * Returns all skills that have a pending update requiring human review:
 * diff-gated by trust policy, not yet approved in the approval lock, and not
 * explicitly rejected. Rejected versions are omitted — they will not re-surface
 * until a newer version arrives.
 *
 * Detects active adapters from the passed list to compute a graded diff of
 * currently materialized files vs the incoming bundle. Undetected adapters
 * contribute nothing to the diff (their on-disk directories are absent).
 */
export async function listPending(
  adapters: Adapter[],
  opts: PendingOptions = {},
): Promise<PendingResult> {
  const {
    configDir = process.env['XDG_CONFIG_HOME'] ?? `${process.env['HOME']}/.config`,
    approvalLockPath = defaultApprovalLockPath(),
    cwd = process.cwd(),
  } = opts

  const state = await readState()
  const policy = await loadPolicy(opts.policyPath)
  let ownKeyId: string | null = null
  try {
    ownKeyId = (await loadAuthorKey(configDir)).keyId
  } catch {
    // No signing key configured — nothing resolves as self.
  }

  // Detect which adapters are active so the diff reflects real on-disk state.
  const active: Adapter[] = []
  for (const adapter of adapters) {
    try {
      if (await adapter.detect()) active.push(adapter)
    } catch {
      // Detection errors are non-fatal for the listing command.
    }
  }

  // Merge the account-scoped decisions so an item approved on another surface
  // (web/desktop) isn't shown as pending here. Best-effort: offline falls back
  // to the local lock only.
  const serverApproved = new Set<string>()
  // Account handle resolves "self" for web-first accounts with no local
  // signing key — pending must agree with sync's gate (see requiresApproval).
  let ownHandle: string | null = null
  try {
    const client = opts.client ?? (await accountClient())
    const acct = await client?.getMyDecisions()
    for (const d of acct?.decisions ?? []) {
      if (d.state === 'approved') serverApproved.add(d.version_hash)
    }
    ownHandle = (await client?.whoami())?.handle ?? null
  } catch {
    // offline / no bearer — local lock is the source.
  }

  const pending: PendingEntry[] = []

  // TCC policy (U2): a parked skill store cannot be content-read, and every
  // pending entry needs its store bundle for hashing + diffing. Report none
  // this run rather than tripping the macOS consent prompt.
  if (isTccParkedPath(join(skilletDir(), 'skills'))) return { pending }

  // Per-adapter parked assessment, ONCE per invocation (each gate call
  // re-reads the grants file): root-parked covers every skill dir under
  // adapter.targetDir, so the per-skill walk below just consults the set.
  const parkedAdapterNames = new Set<string>()
  for (const adapter of active) {
    if (adapter.kind !== 'project' && isTccParkedPath(adapter.targetDir)) {
      parkedAdapterNames.add(adapter.name)
    }
  }

  const pinDir = opts.pinDir ?? `${configDir.replace(/\/$/, '')}/skillet/pinned`
  for (const [slug, entry] of Object.entries(state.skills)) {
    // Same gate as sync, pin-awareness included — the two surfaces must agree.
    const authorPinned = await isAuthorPinned(entry, slug, pinDir)
    if (!requiresApproval(entry, policy, ownKeyId, authorPinned, ownHandle)) continue
    // We treat missing local store state as a diagnostics omission and avoid
    // aborting the entire pending listing.
    if (!(await skillStoreDirExists(slug))) continue

    const bundle = await readBundleFromSkillStore(slug)
    const currentHash = canonicalContentHash(bundle)

    if (serverApproved.has(currentHash)) continue
    if (await checkLock(approvalLockPath, slug, entry.version, currentHash)) continue
    if (await checkRejection(approvalLockPath, slug, entry.version)) continue

    const approvedVersion = await getLastApprovedVersion(approvalLockPath, slug)
    const owner = entry.owner ?? null
    const adapterSlug = bareAdapterSlug(slug, owner)

    const prev = await readCurrentMaterialized(adapterSlug, active, owner, cwd, parkedAdapterNames)
    // One diff against the incoming bundle (not one per agent copy) — see
    // renderUpdateReview for why the fan-out repeats itself.
    const next: Record<string, Buffer> = {}
    for (const [bundlePath, bytes] of bundle) {
      next[bundlePath] = Buffer.from(bytes)
    }

    const quarantined = requiresQuarantineConsent(entry.scan)
    pending.push({
      slug,
      authorKeyId: entry.authorKeyId ?? null,
      approvedVersion,
      incomingVersion: entry.version,
      ...(entry.versionLabel ? { incomingVersionLabel: entry.versionLabel } : {}),
      diff: renderUpdateReview({ prev, next, adapterNames: active.map((a) => a.name) }),
      quarantined,
      scanSummary: quarantined && entry.scan ? renderFindingsSummary(entry.scan) : null,
    })
  }

  return { pending }
}
