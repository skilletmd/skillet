import { readFile, readdir, lstat, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep, basename } from 'node:path'
import matter from 'gray-matter'
import { readBundleFromDir } from '../bundle/read.js'
import { skilletDir } from '../session-token.js'
import { clearOldTrash } from './restore.js'
import {
  ledgerStamp,
  writeRunManifest,
  moveDir,
  detectDriftedGlobalCopies,
  detectStoreDrift,
  readTreeIgnoringDotfiles,
  backupSkillVersion,
  stashBaselineVersion,
  clearBaselineStash,
} from './edits-store.js'
import { ensureBundledCreateSkill, ensureBundledRouteSkill } from './bundled-route-skill.js'
import { BUNDLED_CREATE_SLUG, BUNDLED_ROUTE_SLUG } from './route.js'
import { canonicalContentHash, type DecodedBundle, skillContentHash, stripSkilletBackupPaths } from '@skillet/protocol'
import { parseSkillRef } from '../registry/identifier.js'
import { materializeSlugDir } from '../bundle/write.js'
import { atomicWrite } from '../util/atomic.js'
import { AdapterSkipError, type Adapter } from '../adapter.js'
import {
  readState,
  writeState,
  readBundleFromSkillStore,
  writeBundleToSkillStore,
  skillContentPath,
  skillContentDir,
  upsertSkill,
  ensureSkillStoreReadme,
} from '../kit/store.js'
import { collapsePublishedTwins } from '../kit/dedup-twins.js'
import { writeLockFile } from '../lock.js'
import {
  recordEvent,
  detectInitiator,
  maybeDiscloseActivity,
  reportAvailability,
  activityState,
} from '../metrics.js'
import { loadAuthorKey } from '../signing/index.js'
import {
  verifyEnvelope,
  SignatureError,
  envelopeBindingFromSlug,
  isBundleSignatureV2,
} from '../signing/envelope.js'
import { isSessionAttestedSignature, isEd25519Signature } from '../signing/session-attest.js'
import {
  verifyDelegatedVersionSignature,
  DelegationError,
} from '../signing/delegation.js'
import { listPinnedHandles, loadPinnedKey, authorKeyForVerification, commitAuthorKeyPin } from '../signing/pin.js'
import {
  summarizeInstall,
  renderUpdateReview,
  checkLock,
  recordApproval,
  checkRejection,
  getLastApprovedVersion,
  defaultApprovalLockPath,
  promptApproval,
  promptQuarantineConsent,
  requiresQuarantineConsent,
  loadPolicy,
  resolveTrustMode,
  type TrustPolicyFile,
} from '../trust/index.js'
import { validateAdapterRoot } from '../util/pathsafe.js'
import {
  assessTccRoot,
  isTccParkedPath,
  restoreTccInvocation,
  setTccInvocation,
  snapshotTccInvocation,
} from '../util/tcc-access.js'
import type { SkillEntry, KitState } from '../kit/types.js'
import { pullRegistryUpdates, pullFromUnionManifest, type PullOutcome } from '../registry/pull.js'
import { RegistryError } from '../registry/client.js'
import { resolveRevokedDeviceKeyIds } from '../registry/revoked-device-keys.js'
import { REGISTRY_URL_DEFAULT } from '../kit/types.js'
import { loadRegistryBearer } from '../auth-token.js'
import { readActiveDeviceFile } from '../device-token.js'
import { RegistryClient } from '../registry/client.js'
import { pingInstallMetric } from '../registry/install-metric.js'
import {
  pingDeviceAgents,
  pingDeviceMaterializations,
  deriveMaterializations,
  deriveEditedSkills,
} from './report-device-agents.js'
import { isKitSyncedSkill, kitSyncedState, isSkilletSystemSkill } from '../kit/sync-scope.js'
import {
  materializeOptsForIdentity,
  skillMaterializeIdentity,
} from '../kit/materialize-identity.js'

export interface SyncOptions {
  /** XDG_CONFIG_HOME equivalent for loading user's own signing key */
  configDir?: string
  /** Override the approval lock path (defaults to $XDG_DATA_HOME/skillet/skillet.lock) */
  approvalLockPath?: string
  /**
   * Override the update-trust policy path (defaults to
   * $XDG_CONFIG_HOME/skillet/trust-policy.json). Tests inject a temp path.
   */
  policyPath?: string
  /** Override the TOFU pinned-keys directory (defaults to $XDG_CONFIG_HOME/skillet/pinned) */
  pinDir?: string
  /** Output stream for diff/prompt (defaults to process.stdout) */
  output?: NodeJS.WritableStream
  /** Input stream for approval prompt (defaults to process.stdin) */
  input?: NodeJS.ReadableStream
  /**
   * Pre-approve quarantined-version materialization for non-TTY runs.
   * Defaults to false; CI without this flag refuses to materialize quarantined
   * entries, surfacing them in the skip list. TTY runs ignore this flag —
   * the interactive extra-consent prompt is the only gate.
   */
  allowQuarantined?: boolean
  /**
   * Per-slug quarantine consent grants: each listed slug materializes as if
   * `allowQuarantined` were set, WITHOUT widening consent to any other slug in
   * the same run. Written by review surfaces (the home menu) after the user
   * explicitly confirmed that skill's harm-scan findings — a grant is exactly
   * as wide as what the user saw and accepted.
   */
  allowQuarantinedSlugs?: string[]
  /**
   * When set, force the registry-pull phase to interactive (pull every
   * non-pinned entry) or unattended (skip pull entirely, headless rule) mode
   * regardless of TTY detection. Tests use this; humans rarely need it.
   */
  pullMode?: 'interactive' | 'unattended'
  /** Inject fetch impl for the registry-pull phase (tests). */
  fetchImpl?: typeof fetch
  /** Bearer token to pass through to the registry-pull phase. */
  token?: string
  /**
   * Registry base URL for the union-manifest fetch. Defaults to
   * REGISTRY_URL_DEFAULT. Callers that hold a token SHOULD set this to the
   * URL the token was issued from so the right server is queried.
   */
  registryUrl?: string
  /**
   * When true, skip the interactive approval prompt and auto-approve
   * the graded diff for every incoming skill. Equivalent to setting the
   * SKILLET_APPROVE_PRE=1 env var. Intended for tests and headless CI that use
   * kit-key auth (SKILLET_TOKEN=skillet_k_…).
   */
  approvePre?: boolean
  /**
   * When true, skip the graded-diff approval prompt (e.g. `skillet add -y`).
   * Records approval in the lock without printing the SKILLET_APPROVE_PRE notice.
   */
  autoApprove?: boolean
  /** Override the etag cache path used by the registry-pull phase. */
  etagCachePath?: string
  /**
   * When true, skip per-skill `Skipped "…"` stdout lines during materialize.
   * Failures still land in `SyncResult.failed`. CLI uses this when rendering a
   * grouped kit plan instead of inline skip messages.
   */
  quietSkipLines?: boolean
  /**
   * When set, materialize only these slugs. Used by `skillet add` / `add kit`.
   * Entries need not be kit-synced (`sourceKit`) when listed here.
   */
  slugs?: string[]
  /**
   * Skip registry pull phases (union manifest + per-skill pull). `add` uses
   * this after the skill is already in local kit state.
   */
  skipPull?: boolean
  /**
   * Adapter names that bypass detect() and always materialize (universal
   * `.agents/skills` baseline from the CLI).
   */
  baselineAdapterNames?: string[]
  /**
   * Runtime names for detected agents that READ the universal `.agents/skills`
   * baseline instead of materializing their own dir (e.g. `opencode`). They are
   * appended to the availability report because every skill written to the
   * baseline is also present for them — without adding a second materialization.
   * The CLI computes these from its baseline-reader adapters' detect().
   */
  readerRuntimes?: string[]
  /**
   * Detect registry changes (pull phases only) without materializing adapters.
   * Sets `changed` on the result; skips prune, lock write, and metrics.
   */
  checkOnly?: boolean
  /**
   * Directory containing the bundled `@skillet/route` meta-skill. When set, sync
   * ensures that skill is present in the kit before materializing.
   */
  bundledRouteSkillDir?: string
  /**
   * The route skill's SKILL.md inlined at bundle time. Used as a fallback when
   * `bundledRouteSkillDir` isn't on disk — the packaged desktop sidecar, whose
   * pkg snapshot never carries `dist/bundled-skills`.
   */
  bundledRouteSkillMd?: string
  /**
   * Directory containing the bundled `@skillet/create` playbook that
   * `/skillet create` loads. Same lifecycle as the router: shipped in the CLI,
   * ensured on every sync so it exists with nothing synced.
   */
  bundledCreateSkillDir?: string
  /**
   * The create playbook's SKILL.md inlined at bundle time. Fallback for the
   * packaged desktop sidecar, same reason as `bundledRouteSkillMd`.
   */
  bundledCreateSkillMd?: string
  /**
   * Explicit TCC initiation classification for this run (U3). 'user' lets the
   * run content-read protected-resolving roots (macOS may prompt once, with
   * the app's usage string) and records the per-root unlock marker on
   * success; 'background' admits only roots already unlocked from THIS
   * context (desktop tray vs terminal CLI). Absent → derived from the
   * terminal: an interactive TTY classifies as user, anything else as
   * fail-closed 'unattended' (parked regardless of markers).
   */
  tccInitiation?: 'user' | 'background'
}

export type AdapterResultStatus = 'materialized' | 'skipped-not-detected' | 'failed'

export interface AdapterResult {
  name: string
  status: AdapterResultStatus
  targetDir: string
  /** Number of skills materialized into this adapter (0 when skipped/failed). */
  count: number
  /** Materialized destination paths for this adapter (every written file). */
  paths: string[]
  /** Error message when `status === "failed"`. */
  error?: string
  /**
   * Non-fatal warnings surfaced by this adapter (e.g. OpenClaw shadow
   * detection). Empty when the adapter has nothing to flag. Status is not
   * downgraded — sync still materializes; the warning is informational.
   */
  warnings: string[]
  /**
   * The adapter's root RESOLVES into a macOS TCC-protected folder
   * (~/Documents, ~/Desktop, ~/Downloads), so content reads/writes against it
   * were parked this run (U2). LOCAL-ONLY state: the wire report keeps the
   * existing status vocabulary (an unknown status 400s on deployed
   * registries) — parked never downgrades `status` to `failed`, and the
   * adapter stays in the run's expected-adapter accounting so
   * `materialized_hash` cannot advance past it.
   */
  parked?: boolean
  /**
   * The park is a live permission DENIAL (U3): a content read under this
   * root's unlock marker failed EPERM/EACCES, or the user declined the macOS
   * prompt — so the marker is suspended. Surfaces route to System Settings
   * instead of offering another sync. Local-only, additive, never on the
   * registry wire.
   */
  parkedDenied?: boolean
}

export interface SyncResult {
  /**
   * Flat list of every (adapter × skill) write that succeeded.
   * Kept for backward compatibility with prior callers.
   */
  materialized: Array<{ slug: string; dest: string; hash: string }>
  /** Per-adapter outcome — one entry per adapter passed in, in input order. */
  adapters: AdapterResult[]
  /** Skills that were skipped because integrity verification failed. The
   *  prior materialized files on disk are untouched for these slugs. */
  failed: Array<{ slug: string; reason: string }>
  /**
   * Updates held for review during an interactive sync: content changed
   * upstream and needs approval, so the approved on-disk version was left in
   * place. Interactive sync never interrupts with per-skill diff prompts —
   * callers render this as a one-line summary pointing at `skillet pending`.
   */
  pendingReview: Array<{ slug: string; range: string }>
  /**
   * Per-entry outcome of the registry-pull phase that runs BEFORE
   * the materialize loop. `updated` entries triggered a graded-diff prompt
   * downstream; `failed` entries did not — their on-disk bytes were left
   * untouched, so the materialize phase still proceeds against the prior
   * approved version.
   */
  pull: PullOutcome[]
  /**
   * Per-entry outcome of the union-manifest pull phase (runs before
   * the per-skill pull loop when a token is configured). `updated` means a
   * new ref from a shared kit was fetched and added to local state.
   */
  unionPull: PullOutcome[]
  /**
   * Reconcile/prune: kit-derived skills that left your manifest (unsubscribed or
   * routed off this machine) and were moved to the local trash. Reversible — the
   * bundles sit under `trashDir` until you clear it. Only Skillet-written,
   * unedited copies are moved; a customized skill that leaves the manifest is
   * kept on disk instead (see `localized`).
   */
  pruned: Array<{ slug: string; adapters: string[] }>
  /**
   * Customized skills that left your manifest (unsubscribed / kit removed) and
   * were kept on disk as plain LOCAL skills — the subscription linkage is
   * dropped, the edited bytes stay live, and nothing is trashed (KTD7). No fork
   * ceremony, no held updates.
   */
  localized: Array<{ slug: string }>
  /** Where pruned bundles were moved this run (null when nothing was pruned). */
  trashDir: string | null
  /**
   * Customized skills seen this run (KTD1/KTD3): an edit was found and left live
   * in place, never materialized over. `hasUpdate` is true when a held author
   * update is waiting AND unacknowledged — the quiet signal the CLI/desktop
   * surface. Replaces the earlier capture/escalation/pause result fields.
   */
  customized: Array<{ slug: string; hasUpdate: boolean }>
  lockPath: string
  /** Non-fatal routing or account notices surfaced to the CLI summary. */
  notices: string[]
  /** Set when `checkOnly` — whether a full sync would materialize or prune. */
  changed?: boolean
}

/**
 * Determines whether a skill update is DIFF-GATED (human must approve) or
 * AUTO-APPLIES, via the trust-policy precedence (skill > author > kit >
 * global-by-source-class). See trust/policy.ts for the resolution rules and
 * the two independent global defaults.
 *
 * This decides ONLY whether a human reviews the diff. It NEVER governs whether
 * the content is verified: even when this returns false (auto-apply), the
 * quarantine (scan) gate and verifyForMaterialize (Ed25519 signature)
 * gate below still run unconditionally. Trust governs review, not safety.
 */
// Exported as the ONE approval gate: `skillet pending` must agree with sync
// about what needs review, or held updates become invisible (a stale copy in
// pending.ts once missed session-attested versions exactly this way).
export function requiresApproval(
  entry: SkillEntry,
  policy: TrustPolicyFile,
  ownKeyId: string | null,
  authorPinned?: boolean,
  ownHandle?: string | null,
): boolean {
  // U5 Option B: session-attested registry versions require review — except
  // your OWN skills. Editing your skill on the web IS the consent moment
  // (add = consent baseline), and the web's pendingTargets deliberately never
  // queues self-authored rows, so gating here left web edits of your own
  // skills pending forever with no approval surface. The gate is also not a
  // real hijacked-session defense: the web session is the account's approval
  // surface, so a hijacker could approve their own edit anyway. Scan
  // (quarantine) and signature verification still run unconditionally below.
  //
  // "Self" resolves by local signing key OR account handle: web-first
  // accounts publish exclusively through web flows and never mint a local
  // key, so key identity alone cannot recognize their own skills. The handle
  // comes from the same trusted source (the registry) as authorKeyId, so it
  // widens recognition, not the trust boundary.
  if (entry.signature && isSessionAttestedSignature(entry.signature)) {
    const keySelf =
      ownKeyId != null && entry.authorKeyId != null && entry.authorKeyId === ownKeyId
    const authorHandle = entryAuthorHandle(entry)
    const handleSelf =
      ownHandle != null && authorHandle != null && authorHandle === ownHandle
    if (!keySelf && !handleSelf) return true
    if (handleSelf && !keySelf) return false
    // Key-self: fall through to resolveTrustMode, which resolves own-key
    // content as auto.
  }
  const mode = resolveTrustMode(
    {
      slug: entry.slug,
      authorKeyId: entry.authorKeyId ?? null,
      source: entry.source,
      sourceClass: entry.sourceClass ?? null,
      sourceKit: entry.sourceKit ?? null,
      subscriberTrust: entry.subscriberTrust ?? null,
      authorPinned,
    },
    policy,
    ownKeyId,
  )
  return mode === 'gate'
}

/** The author handle a state entry belongs to: explicit owner, else the
 *  `@author/slug` prefix. Null for unowned local content. */
function entryAuthorHandle(entry: SkillEntry): string | null {
  if (entry.owner) return entry.owner
  if (entry.slug.startsWith('@')) {
    const sep = entry.slug.indexOf('/')
    if (sep > 1) return entry.slug.slice(1, sep)
  }
  return null
}

function pullOutcomesIndicateWork(outcomes: PullOutcome[]): boolean {
  // 'gone' means a deleted-upstream skill that reconcile will prune — real work.
  return outcomes.some(
    (o) => o.status === 'updated' || o.status === 'failed' || o.status === 'gone',
  )
}

function manifestPruneWouldRun(
  state: KitState,
  manifestRefs: Set<string> | null,
  bearerKind: 'session' | 'device' | 'kit' | 'none' | 'unknown',
  skipPull: boolean,
): boolean {
  if (skipPull || !manifestRefs) return false
  if (bearerKind !== 'session' && bearerKind !== 'device') return false
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (!isKitSyncedSkill(entry)) continue
    if (entry.source === 'registry' && !manifestRefs.has(slug)) return true
  }
  return false
}

async function pendingGatedMaterialize(
  state: KitState,
  policy: TrustPolicyFile,
  ownKeyId: string | null,
  effectivePinDir: string,
  approvalLockPath: string,
  approvedHashes: Set<string>,
  rejectedHashes: Set<string>,
  ownHandle: string | null = null,
): Promise<boolean> {
  // TCC policy (U2/U3): a parked skill store cannot be content-read, so
  // nothing gated can be evaluated (or materialized) this run — report no work.
  if (isTccParkedPath(join(skilletDir(), 'skills'))) return false
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (!isKitSyncedSkill(entry)) continue
    if (entry.customized_from) continue // held updates never auto-materialize
    const authorPinned = await isAuthorPinned(entry, slug, effectivePinDir)
    if (!requiresApproval(entry, policy, ownKeyId, authorPinned, ownHandle)) continue
    const bundle = await readBundleFromSkillStore(slug)
    const currentHash = canonicalContentHash(bundle)
    if (rejectedHashes.has(currentHash)) continue
    if (approvedHashes.has(currentHash)) continue
    const locallyApproved = await checkLock(approvalLockPath, slug, entry.version, currentHash)
    if (locallyApproved) continue
    const isRejected = await checkRejection(approvalLockPath, slug, entry.version)
    if (isRejected) continue
    return true
  }
  return false
}

export async function isAuthorPinned(
  entry: SkillEntry,
  slug: string,
  pinDir: string,
): Promise<boolean | undefined> {
  if (entry.source !== 'registry') return undefined
  try {
    let handle: string
    if (entry.owner) {
      handle = entry.owner.startsWith('@') ? entry.owner.slice(1) : entry.owner
    } else if (slug.includes('/')) {
      const [authorPart] = slug.startsWith('@') ? slug.slice(1).split('/') : slug.split('/')
      handle = authorPart ?? ''
    } else {
      handle = parseSkillRef(slug.startsWith('@') ? slug : `@${slug}`).author
    }
    if (!handle) return false
    const pinned = await loadPinnedKey(handle, pinDir)
    return pinned !== null
  } catch {
    return false
  }
}

/** Project adapters may resolve a different cwd than sync (e.g. desktop ~/.skillet). */
async function resolveAdapterMaterializeCwd(
  adapter: Adapter,
  syncCwd: string,
): Promise<string> {
  if (adapter.resolveMaterializeCwd) {
    const resolved = await adapter.resolveMaterializeCwd(syncCwd)
    if (resolved) return resolved
  }
  return syncCwd
}

/**
 * Reads all currently materialized files for each adapter's skill directory.
 *
 * Walks the full bundle tree under adapter.targetSkillDir(slug) so that every
 * bundle file (not just SKILL.md) appears in the graded diff. If the
 * skill directory does not exist yet, the adapter's prev state is empty (first
 * install).
 */
async function readCurrentMaterialized(
  identity: ReturnType<typeof skillMaterializeIdentity>,
  adapters: Adapter[],
  cwd: string,
  parkedAdapterNames: ReadonlySet<string>,
): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {}
  for (const adapter of adapters) {
    const adapterCwd = await resolveAdapterMaterializeCwd(adapter, cwd)
    if (adapter.kind === 'project' && !adapterCwd) continue
    // TCC policy gate (U2/U3): a global root that is parked for this
    // invocation cannot be walked — its contents are UNKNOWN, not absent, so
    // it is skipped here and the caller must not read the empty result as a
    // first install. Project roots are exempt: a user-initiated run inside a
    // Documents repo is that user's own consent context. Parkedness is the
    // caller's once-per-run assessment of adapter.targetDir (skill dirs live
    // under it, so root-parked covers them) — not recomputed per skill.
    if (adapter.kind !== 'project' && parkedAdapterNames.has(adapter.name)) continue
    const skillDir = adapter.targetSkillDir(
      identity.adapterSlug,
      materializeOptsForIdentity(identity, adapterCwd),
    )
    await walkMaterialized(skillDir, skillDir, adapter.name, result)
  }
  return result
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

/**
 * Per acceptance criterion 3 + PROTOCOL §6.4:
 *
 *   "Verify the signature and recompute the content hash before writing.
 *    Hash mismatch or bad signature aborts that skill (`integrity_failed`)
 *    and leaves existing files untouched."
 *
 * Returns null on success. Returns a reason string on failure — caller MUST
 * skip materialize for this slug, leaving any prior on-disk copy in place.
 *
 * The TOFU resolution happens here: a registry-sourced skill seen for the
 * first time pins the served pubkey; a subsequent run with a different
 * pubkey throws `key_id_mismatch` (loud, never silent — PROTOCOL §4).
 *
 * Exported so callers and tests can exercise the integrity gate directly
 * without standing up adapters/state.
 */
export async function verifyForMaterialize(
  entry: SkillEntry,
  recomputedContentHash: string,
  pinDir: string,
  opts: {
    revokedDeviceKeyIds?: Set<string>;
    revocationFetchOk?: boolean;
    /** Legacy polluted publish where entry.hash counted `.skillet-backup` paths. */
    legacyContentHash?: string;
  } = {},
): Promise<string | null> {
  const hashMatchesEntry = (storeHash: string): boolean =>
    storeHash === entry.hash ||
    (opts.legacyContentHash != null && opts.legacyContentHash === entry.hash);
  // Locally-imported skills are not signed; the recomputed hash is the
  // only integrity anchor.
  if (entry.source === 'local') {
    // entry.hash is already the canonical `sha256:`-prefixed bundle hash
    // compare verbatim, no hashRef wrapper.
    if (!hashMatchesEntry(recomputedContentHash)) {
      return `integrity_failed: local content hash drifted (${recomputedContentHash} vs ${entry.hash})`
    }
    return null
  }

  // Registry-sourced: signature required; session-attested versions use
  // content-hash match (registry attested at publish), Ed25519/delegated
  // paths require author key material.
  if (!entry.signature) {
    return 'integrity_failed: registry-sourced skill missing signature envelope'
  }

  if (isSessionAttestedSignature(entry.signature)) {
    if (!hashMatchesEntry(recomputedContentHash)) {
      return `integrity_failed: session-attested content hash drifted (${recomputedContentHash} vs ${entry.hash})`
    }
    return null
  }

  if (!entry.authorKeyId || !entry.authorPubBase64) {
    return 'integrity_failed: registry-sourced skill missing author key material'
  }

  try {
    if (!isEd25519Signature(entry.signature)) {
      return 'integrity_failed: registry-sourced skill has unsupported signature alg'
    }
    if (entry.signature.sig_version === 2 && !isBundleSignatureV2(entry.signature)) {
      return 'integrity_failed: signature claims v2 but envelope is not v2-bound'
    }
    const handle = await resolveMaterializeHandle(entry, pinDir)
    const { keyObject, pinnedPrimary, needsPinAfterVerify } = await authorKeyForVerification(
      handle,
      { key_id: entry.authorKeyId, pub: entry.authorPubBase64 },
      pinDir,
    )
    if (entry.signature.key_id === entry.authorKeyId) {
      const binding = isBundleSignatureV2(entry.signature)
        ? envelopeBindingFromSlug(
            entry.slug,
            entry.version,
            entry.authorKeyId,
            entry.owner,
            entry.name,
          )
        : undefined
      verifyEnvelope(recomputedContentHash, entry.signature, keyObject, {
        expectedKeyId: entry.authorKeyId,
        binding,
      })
    } else {
      if (opts.revocationFetchOk === false) {
        return 'integrity_failed: device-key revocation list unavailable'
      }
      verifyDelegatedVersionSignature({
        contentHash: recomputedContentHash,
        versionSignature: entry.signature,
        signedDelegation: entry.delegation,
        pinnedPrimary: { keyId: pinnedPrimary.keyId, pub: pinnedPrimary.pub },
        handle,
        requiredScope: 'approve',
        revokedDeviceKeyIds: opts.revokedDeviceKeyIds,
      })
    }
    if (needsPinAfterVerify) {
      await commitAuthorKeyPin(
        handle,
        { key_id: entry.authorKeyId, pub: entry.authorPubBase64 },
        entry.version,
        pinDir,
      )
    }
  } catch (err) {
    if (err instanceof SignatureError) {
      return `${err.code}: ${err.message.replace(/^[a-z_]+: /, '')}`
    }
    if (err instanceof DelegationError) {
      return `${err.code}: ${err.message}`
    }
    return `integrity_failed: ${(err as Error).message}`
  }
  return null
}

/** Extract the handle from a slug like `@taylor/festival-ops` → `taylor`. */
function handleFromSlug(slug: string): string {
  const m = slug.match(/^@?([a-z0-9-]+)\//)
  if (!m) {
    throw new Error(`Cannot derive handle from slug ${JSON.stringify(slug)}`)
  }
  return m[1]
}

async function resolveMaterializeHandle(entry: SkillEntry, pinDir: string): Promise<string> {
  if (entry.owner && entry.owner.length > 0) return entry.owner

  try {
    return handleFromSlug(entry.slug)
  } catch {
    // Legacy pre-canonical entries can store bare slugs. Fall back to the
    // local TOFU pin store using the entry's author key material.
  }

  if (!entry.authorKeyId && !entry.authorPubBase64) {
    throw new Error(`Cannot derive handle from slug ${JSON.stringify(entry.slug)}`)
  }

  const handles = await listPinnedHandles(pinDir)
  const matches: string[] = []
  for (const handle of handles) {
    const pinned = await loadPinnedKey(handle, pinDir)
    if (!pinned) continue
    if (entry.authorKeyId && pinned.key_id === entry.authorKeyId) {
      matches.push(handle)
      continue
    }
    if (entry.authorPubBase64 && pinned.pub === entry.authorPubBase64) {
      matches.push(handle)
    }
  }

  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length > 1) {
    throw new Error(
      `Cannot derive unique handle for legacy slug ${JSON.stringify(entry.slug)}; matched pins: ${matches.join(', ')}`,
    )
  }
  throw new Error(
    `Cannot derive handle from slug ${JSON.stringify(entry.slug)} and no matching pinned author key`,
  )
}

/**
 * Reconcile a customized skill's held-update marker against the freshly-pulled
 * upstream hash (`entry.hash` after the pull phase). Mutates `entry.held_update`
 * and returns whether it changed (so the caller persists only on a change):
 *  - upstream back at the customized baseline → clear any held update.
 *  - a NEW upstream hash (or first divergence) → record it (acknowledgement reset
 *    so the quiet signal surfaces again).
 *  - the same hash already held → no change (Keep mine's ack, if any, survives).
 */
function reconcileHeldUpdate(entry: SkillEntry): boolean {
  const base = entry.customized_from!.hash
  const upstream = entry.hash
  if (upstream === base) {
    if (entry.held_update) {
      delete entry.held_update
      return true
    }
    return false
  }
  if (!entry.held_update || entry.held_update.hash !== upstream) {
    entry.held_update = { version: entry.version, hash: upstream }
    return true
  }
  return false
}

/**
 * A held update surfaces (nudges) when it exists, has not been acknowledged,
 * and is not YANKED. A yanked held version (the author pulled it) must never
 * nudge — installing it would resurrect a withdrawn version (F6).
 */
function heldUpdateSurfaces(entry: SkillEntry): boolean {
  return !!entry.held_update && !entry.held_update.acknowledged && !entry.held_update.yanked
}

interface PruneResult {
  pruned: Array<{ slug: string; adapters: string[] }>
  /** Customized skills that left the manifest and were kept on disk as local skills. */
  localized: Array<{ slug: string }>
  trashDir: string | null
}

/**
 * Reconcile the machine to the manifest: skills that left your kits (you
 * unsubscribed, or routed the kit off this device) are removed from the
 * adapters and moved to `~/.skillet/trash/<run>/` — reversible, never a hard
 * delete.
 *
 * Deleting files is scary, so the rule is: only remove a skill when we can
 * cleanly account for EVERY adapter copy. Fences:
 *  1. Skillet owns it: only `source:'registry'`, kit-derived (`sourceKit`),
 *     non-pinned, canonical `@owner/slug`-keyed entries are touched. Local,
 *     pinned, directly-added, and alias-keyed entries are invisible to the pruner.
 *  2. You made it yours: a `customized_from` skill that leaves the manifest is
 *     kept on disk as a plain LOCAL skill (subscription linkage dropped, bytes
 *     kept — KTD7); it is never trashed. Any other readable edit (hash ≠ what we
 *     wrote) is unverifiable and KEEPS the skill managed rather than deleting it.
 *  3. Authoritative only: the caller passes `manifestRefs` solely on a confirmed
 *     full-union (session/device) 200 — never on 304/401/error, never kit-key.
 *  4. Global adapters only: project-scoped adapters (Cursor/Windsurf/Devin/…)
 *     are skipped — their copies live inside the user's project repo, are keyed
 *     per-directory, and an account-wide sync must never reach into a repo to
 *     delete files. Those copies are managed per-project, not here.
 *  5. Account for every (global) copy: a dir we can't read (transformed layout,
 *     permission error, symlink) or a global adapter that won't resolve is
 *     "unverifiable" → KEEP the skill rather than risk orphaning a copy we
 *     couldn't see. Trash happens only when every copy is absent or a clean
 *     verbatim match, and we drop state only once every copy has moved.
 *  6. Empty-manifest guard: an empty manifest zeroes the machine out only for an
 *     account-bound caller (`allowZeroOut`); otherwise it's ignored.
 *
 * Conservative by design: a global transforming adapter would also be KEPT
 * (unverifiable). Complete coverage of non-verbatim layouts needs adapter-aware
 * removal — a deliberate follow-up.
 */
/**
 * Whether an EMPTY manifest may zero a machine out. Allowed only for an
 * account-bound caller: the server's `account_scope === 'user'` (so a bound
 * device that routed off every kit can zero out), or — for an older server that
 * omits the field — the session-only fallback.
 *
 * The parameter is `string | undefined` on purpose: `account_scope` arrives as
 * unvalidated JSON, so even though our types only admit `'user'`, an OLDER
 * self-hosted registry can still send the retired `'anonymous'` (or anything
 * else) at runtime. Fail safe: an empty manifest with an unrecognized scope
 * must NEVER zero local skills out.
 */
export function zeroOutAllowed(
  accountScope: string | undefined,
  bearerKind: string,
): boolean {
  if (accountScope === 'user') return true
  if (accountScope !== undefined) return false // unrecognized scope → fail safe, never zero out
  return bearerKind === 'session' // old server omitted the field → fallback
}

/**
 * Convert an unsubscribed customized (or edited) registry entry into a plain
 * local skill in place: keep the bytes and the entry, drop everything that
 * would make sync re-prune it or track author updates for it (KTD7).
 */
function localizeCustomizedEntry(entry: SkillEntry): void {
  entry.source = 'local'
  delete entry.customized_from
  delete entry.held_update
  delete entry.sourceKit
  delete entry.sourceKitId
  delete entry.subscriberTrust
  entry.updatedAt = new Date().toISOString()
}

/** Pull `name`/`description` out of a bundle's SKILL.md frontmatter, if present. */
function nameDescFromBundle(bundle: DecodedBundle): { name?: string; description?: string } {
  const skillMd = bundle.get('SKILL.md')
  if (!skillMd) return {}
  try {
    const fm = matter(Buffer.from(skillMd).toString('utf8'))
    const d = fm.data as Record<string, unknown>
    const out: { name?: string; description?: string } = {}
    if (typeof d.name === 'string' && d.name) out.name = d.name
    if (typeof d.description === 'string') out.description = d.description
    return out
  } catch {
    return {}
  }
}

/**
 * F4: before flipping a customized/edited unsubscribed skill to LOCAL, import
 * its LIVE on-disk bundle into the skill store and align the entry's
 * hash/name/description to it. Without this the store/record still points at the
 * old AUTHOR bytes, so a later store-based op (materialize, propose, re-sync)
 * resurrects the wrong content. Mutates `entry` in place.
 */
async function importLiveTreeToStore(
  slug: string,
  bundle: DecodedBundle,
  entry: SkillEntry,
): Promise<void> {
  await writeBundleToSkillStore(slug, bundle)
  entry.hash = canonicalContentHash(bundle)
  entry.materialized_hash = entry.hash
  const nd = nameDescFromBundle(bundle)
  if (nd.name) entry.name = nd.name
  if (nd.description !== undefined) entry.description = nd.description
}

export async function reconcilePrune(
  state: KitState,
  manifestRefs: Set<string>,
  adapters: Adapter[],
  opts: {
    allowZeroOut?: boolean
    /**
     * Pre-pull hash/version per slug (RF5): mirrors the drift path's baseline
     * fallback so a legacy entry (no `materialized_hash`) whose pull advanced
     * `entry.hash` this run still baselines on what was actually on disk, not the
     * just-persisted hash — else the last-materialized author bytes read as an
     * "edit" and a racing unsubscribe localizes a phantom local skill.
     */
    prePullSnapshots?: Map<string, { hash: string; version: number }>
    /**
     * Manifest-absent refs HELD from pruning (R5): a kit author removed them
     * and the user hasn't decided Remove vs Keep on the web yet. Held skills
     * stay in state and on disk, still materialized, until the decision.
     */
    holdRefs?: Set<string>
    /**
     * Names of global adapters whose root is TCC-parked this run, precomputed
     * once by sync() (root-parked covers every skill dir under it). Direct
     * callers may omit it; the per-adapter assessment then runs here once.
     */
    parkedAdapterNames?: ReadonlySet<string>
  } = {},
): Promise<PruneResult> {
  // Fence 5 — empty-manifest guard (account-bound zero-out only).
  if (manifestRefs.size === 0 && !opts.allowZeroOut) {
    return { pruned: [], localized: [], trashDir: null }
  }

  const parkedAdapterNames =
    opts.parkedAdapterNames ??
    new Set(
      adapters
        .filter((a) => a.kind !== 'project' && isTccParkedPath(a.targetDir))
        .map((a) => a.name),
    )

  const candidates = Object.entries(state.skills).filter(([slug, entry]) => {
    if (entry.source !== 'registry') return false // never your local skills
    if (!entry.sourceKit) return false // only kit-derived (skip directly-added)
    if (entry.pinned) return false // never pinned
    if (!slug.startsWith('@')) {
      // Bare keys are normally aliases of a served canonical entry and stay
      // out of prune's reach. But a registry-sourced bare entry whose tail
      // matches NO served ref is a ghost twin (upload-conversion or import
      // residue whose upstream is gone) — nothing will ever serve or re-key
      // it, so the canonical-only rule would keep it alive forever. Same
      // downstream guards apply: an edited copy still localizes, not trashes.
      return ![...manifestRefs].some((ref) => ref.endsWith(`/${slug}`))
    }
    if (opts.holdRefs?.has(slug)) return false // removal undecided on web → hold
    return !manifestRefs.has(slug) // gone from your manifest → candidate
  })
  if (candidates.length === 0) return { pruned: [], localized: [], trashDir: null }

  // Unique per run so back-to-back syncs can't clobber each other's trash/ledger.
  const trashDir = join(skilletDir(), 'trash', ledgerStamp())
  const pruned: PruneResult['pruned'] = []
  const localized: PruneResult['localized'] = []
  const ledger: Array<Record<string, unknown>> = []

  for (const [slug, entry] of candidates) {
    const owner = entry.owner ?? null
    const identity = skillMaterializeIdentity(slug, owner)

    // Inspect each GLOBAL adapter copy. Classify as absent, a clean verbatim
    // match (movable), edited, or unverifiable (present but we can't read it).
    //
    // Project-scoped adapters are deliberately NOT pruned: their copies live
    // inside the user's project repo, are keyed per-directory (some even share
    // one rules dir across skills), and there's no single cwd that identifies
    // which project a skill was synced into. Skillet must not reach into a repo
    // to delete files during an account-wide sync — those copies are managed
    // per-project. Leaving them is the safe, correct choice.
    const movable: Array<{ name: string; dir: string }> = []
    let edited = false
    let unverifiable = false
    // The live on-disk bundle to import if this skill localizes (F4). Prefer an
    // edited copy (the user's actual bytes) over a clean one.
    let liveBundle: DecodedBundle | null = null
    // F1-prune: compare against what we LAST MATERIALIZED here, not `entry.hash`.
    // `entry.hash` is advanced by the pull phase before materialize; a pull that
    // persisted a new hash whose materialize never landed leaves the OLD author
    // bytes on disk. Baselining on `entry.hash` would misread those as an edit
    // and localize a phantom local skill when an unsubscribe races an update.
    // RF5: fall back to the pre-pull snapshot (mirrors the drift path at the
    // materialize baseline) so a LEGACY entry with no `materialized_hash` still
    // baselines on the pre-pull bytes, not the just-advanced `entry.hash`.
    const pruneBaseline =
      entry.materialized_hash ?? opts.prePullSnapshots?.get(slug)?.hash ?? entry.hash
    for (const adapter of adapters) {
      if (adapter.kind === 'project') continue // never prune project-repo files
      let dir: string
      try {
        dir = adapter.targetSkillDir(
          identity.adapterSlug,
          materializeOptsForIdentity(identity),
        )
      } catch {
        unverifiable = true // a global adapter that can't resolve → don't risk it
        continue
      }
      // TCC policy gate (U2/U3), BEFORE any filesystem touch: a root that is
      // parked for this invocation may hold a live copy we are not allowed to
      // read, so parked maps to present-but-unverifiable — NEVER
      // prunable/absent. An unsubscribe must not trash state while a copy
      // waits in a parked root. Parkedness is assessed once per adapter root
      // (skill dirs live under it), never re-derived per skill.
      if (parkedAdapterNames.has(adapter.name)) {
        unverifiable = true
        continue
      }
      let st
      try {
        st = await lstat(dir)
      } catch {
        continue // ENOENT / unreachable → no copy here
      }
      if (st.isSymbolicLink()) {
        unverifiable = true // never follow/move a symlinked skill dir
        continue
      }
      if (!st.isDirectory()) continue
      let bundle
      try {
        bundle = await readBundleFromDir(dir)
      } catch {
        unverifiable = true // exists but unreadable (transformed layout, EACCES)
        continue
      }
      if (!bundle || bundle.size === 0) {
        unverifiable = true // a dir is there but we can't make sense of it
        continue
      }
      let onDiskHash: string | null = null
      try {
        onDiskHash = canonicalContentHash(bundle)
      } catch {
        edited = true // unhashable → treat as edited, never delete
        continue
      }
      if (onDiskHash !== pruneBaseline) {
        edited = true
        liveBundle = bundle // the edited tree is the live one to preserve
      } else {
        movable.push({ name: adapter.name, dir })
        if (!liveBundle) liveBundle = bundle
      }
    }

    // Fence 2 (KTD7): a customized skill — or any skill with an edited on-disk
    // copy — is yours. Keep the bytes exactly where they are and convert the
    // entry to a plain LOCAL skill: drop the subscription linkage (sourceKit,
    // held updates, the customized marker) so it is neither re-pruned nor
    // update-tracked, but never trash an edit. No fork, no state removal.
    if (entry.customized_from || edited) {
      // F4: no readable live tree → we can't prove what the local bytes are, so
      // keep the skill MANAGED (unverifiable) rather than mint a phantom local
      // skill whose store points at stale author bytes.
      if (!liveBundle) continue
      // RF8: the entry is leaving the customized world for a plain local skill —
      // drop its baseline stash so the baselines store doesn't accumulate.
      if (entry.customized_from) await clearBaselineStash(entry.customized_from.hash)
      // Import the live edit into the store and align hash/name/description to it
      // BEFORE flipping to local, so later store-based ops see the edit.
      await importLiveTreeToStore(slug, liveBundle, entry)
      localizeCustomizedEntry(entry)
      localized.push({ slug })
      continue
    }

    // Fence 4: a copy we couldn't account for → keep the skill managed entirely.
    if (unverifiable) continue

    if (movable.length === 0) {
      // Cleanly accounted for, nothing on disk → drop the orphaned state entry.
      delete state.skills[slug]
      continue
    }

    // Move every copy; only drop state once they've ALL moved (no half-removal).
    // Buffer this skill's moves; commit to the shared ledger only if ALL copies
    // move. On partial failure, roll the moved copies back so the skill stays
    // whole and the ledger never references a skill whose state we kept.
    const perSkill: Array<{ name: string; from: string; to: string }> = []
    let allMoved = true
    for (const { name, dir } of movable) {
      const dest = join(trashDir, name, basename(dir))
      if (await moveDir(dir, dest)) {
        perSkill.push({ name, from: dir, to: dest })
      } else {
        allMoved = false
        break
      }
    }
    if (allMoved && perSkill.length > 0) {
      delete state.skills[slug]
      for (const m of perSkill) {
        ledger.push({ slug, owner, hash: entry.hash, adapter: m.name, from: m.from, to: m.to })
      }
      pruned.push({ slug, adapters: perSkill.map((m) => m.name) })
    } else if (!allMoved) {
      // Partial failure: move the trashed copies back to their source. The skill
      // is kept whole; the next sync retries the prune cleanly.
      for (const m of perSkill) await moveDir(m.to, m.from)
    }
  }

  if (ledger.length > 0) {
    await writeRunManifest(trashDir, {
      trashedAt: new Date().toISOString(),
      kind: 'prune',
      items: ledger,
    })
  }

  return { pruned, localized, trashDir: pruned.length > 0 ? trashDir : null }
}

/** Drop pre-0.1.24 `skillet--route` dirs after we materialize the flat `skillet` folder. */
async function removeLegacyBundledRouteMaterialization(
  adapters: Adapter[],
): Promise<void> {
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    let legacyDir: string
    try {
      legacyDir = adapter.targetSkillDir('route', { owner: 'skillet' })
    } catch {
      continue
    }
    // Parked roots (U2/U3) take no writes/deletes either.
    if (isTccParkedPath(legacyDir)) continue
    try {
      await rm(legacyDir, { recursive: true, force: true })
    } catch {
      // Best-effort migration; never block sync.
    }
  }
}

// The fenced managed block + rule marker the OLD Windsurf adapter wrote.
const WINDSURF_MANAGED_START = '<!-- skillet:start -->'
const WINDSURF_MANAGED_END = '<!-- skillet:end -->'
const WINDSURF_RULE_MARKER = '<!-- skillet:skill '

/**
 * Clean up artifacts the OLD (project-scoped, rules-flattening) Windsurf
 * adapter left in the sync's cwd, now that windsurf is a global skills-folder
 * materializer. Cwd-local by nature: the old adapter wrote
 * `.windsurf/rules/<owner>--<slug>.md` and a fenced block in `AGENTS.md` under
 * whatever cwd it ran in, and an account-wide sync must not reach into every
 * repo (prune policy). Recognition-gated and never removes user content: a
 * rule file goes only if it still carries our marker header; AGENTS.md loses
 * only the fenced block, never the file, and the file is never created.
 */
async function cleanupLegacyWindsurfArtifacts(cwd: string): Promise<void> {
  const rulesDir = join(cwd, '.windsurf', 'rules')
  let entries: string[]
  try {
    entries = await readdir(rulesDir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const filePath = join(rulesDir, name)
    try {
      const content = await readFile(filePath, 'utf8')
      if (content.startsWith(WINDSURF_RULE_MARKER)) {
        await rm(filePath, { force: true })
      }
    } catch {
      // unreadable → leave it; never guess
    }
  }

  const agentsMd = join(cwd, 'AGENTS.md')
  try {
    const existing = await readFile(agentsMd, 'utf8')
    const startIdx = existing.indexOf(WINDSURF_MANAGED_START)
    const endIdx = existing.indexOf(WINDSURF_MANAGED_END)
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = existing.slice(0, startIdx).trimEnd()
      const after = existing.slice(endIdx + WINDSURF_MANAGED_END.length).replace(/^\n+/, '')
      const next = after ? `${before}\n\n${after}\n` : `${before}\n`
      await atomicWrite(agentsMd, next, { backup: true })
    }
  } catch {
    // no AGENTS.md, or unreadable → nothing to strip
  }
}

/**
 * Remove Skillet-managed materializations from Codex's LEGACY `~/.codex/skills`
 * root. Codex moved to `~/.agents/skills` in June 2026 but still reads the old
 * root, so pre-move copies surface as duplicates in skill selectors. A legacy
 * copy is ours-and-unedited when its content matches ANY hash Skillet recorded
 * for the skill — current store bundle, `materialized_hash`, or `entry.hash`;
 * matching only the current store would strand every legacy copy of a
 * since-updated skill (the common case). No match → the user edited it; leave
 * it and surface a notice. Removals go through the recoverable trash move.
 *
 * Scope note: this matches only dirs named the way CURRENT Skillet names them
 * (`<owner>--<slug>` via materializeSlugDir). Legacy copies written under a
 * different scheme (e.g. bare slugs) or by a non-Skillet installer are not
 * recognized and are deliberately left untouched — we never delete a dir we
 * cannot prove is our own.
 */
async function cleanupLegacyCodexSkills(
  state: KitState,
  notices: string[],
): Promise<void> {
  const legacyRoot = join(homedir(), '.codex', 'skills')
  if (isTccParkedPath(legacyRoot)) return // parked (U2/U3): no content reads
  try {
    await lstat(legacyRoot)
  } catch {
    return
  }
  const trashDir = join(skilletDir(), 'trash', ledgerStamp())
  for (const [slug, entry] of Object.entries(state.skills)) {
    const identity = skillMaterializeIdentity(slug, entry.owner ?? null)
    let legacyDir: string
    try {
      legacyDir = join(legacyRoot, materializeSlugDir(identity.adapterSlug, identity.owner, {}))
    } catch {
      continue
    }
    let st
    try {
      st = await lstat(legacyDir)
    } catch {
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue

    let onDiskHash: string | null = null
    try {
      const bundle = await readBundleFromDir(legacyDir)
      if (bundle && bundle.size > 0) onDiskHash = canonicalContentHash(bundle)
    } catch {
      onDiskHash = null
    }
    const known = new Set(
      [entry.materialized_hash, entry.hash].filter((h): h is string => typeof h === 'string'),
    )
    try {
      const storeBundle = await readBundleFromSkillStore(slug)
      if (storeBundle && storeBundle.size > 0) known.add(canonicalContentHash(storeBundle))
    } catch {
      // store copy unreadable — rely on recorded hashes
    }

    if (onDiskHash && known.has(onDiskHash)) {
      await moveDir(legacyDir, join(trashDir, `codex--${identity.adapterSlug}`))
    } else {
      notices.push(
        `Legacy Codex copy of "${slug}" at ${legacyDir} differs from every version Skillet recorded — left in place; delete it manually if unwanted.`,
      )
    }
  }
}

/**
 * Runtime names for the availability report: the materializing adapters that
 * were active, plus any detected baseline-READER runtimes (e.g. `opencode`) that
 * read the universal `.agents/skills` dir the baseline just wrote. Every skill
 * materialized to the baseline is present for those readers too, so they earn an
 * availability row without a second materialization. Deduped, order-stable.
 */
export function mergeAvailabilityRuntimes(
  activeNames: string[],
  readerRuntimes: string[] | undefined,
): string[] {
  return [...new Set([...activeNames, ...(readerRuntimes ?? [])])]
}

export async function sync(
  cwd: string,
  adapters: Adapter[],
  opts: SyncOptions = {},
): Promise<SyncResult> {
  // TCC invocation classification (U3), set BEFORE any content-read gate runs
  // (the pull phases consult it). Only an explicit signal is applied — absent,
  // the gate derives it fail-closed from the terminal (TTY = user, anything
  // else = unattended). The override is process-scoped, so restore the
  // caller's value on the way out: sync must only reset what sync set, never
  // clobber a classification a host installed before calling it.
  if (!opts.tccInitiation) return syncInner(cwd, adapters, opts)
  const callerInvocation = snapshotTccInvocation()
  setTccInvocation({ initiation: opts.tccInitiation })
  try {
    return await syncInner(cwd, adapters, opts)
  } finally {
    restoreTccInvocation(callerInvocation)
  }
}

async function syncInner(
  cwd: string,
  adapters: Adapter[],
  opts: SyncOptions,
): Promise<SyncResult> {
  const {
    configDir = process.env['XDG_CONFIG_HOME'] ?? `${process.env['HOME']}/.config`,
    approvalLockPath = defaultApprovalLockPath(),
    pinDir,
    output = process.stdout as unknown as NodeJS.WritableStream,
    input = process.stdin as unknown as NodeJS.ReadableStream,
    allowQuarantined = false,
    allowQuarantinedSlugs = [],
    quietSkipLines = false,
  } = opts

  const state = await readState()

  // Self-heal stale "published twin" duplicates every sync (not just on a 200
  // union pull). Publishing a local skill leaves a bare-key entry behind that
  // the next manifest pull re-keys to `@owner/slug` — but that dedup only runs
  // when the manifest returns 200. On a stable (304) manifest the bare twin
  // never gets swept, so it lingers and inflates both the tray's "only on this
  // device" count and the upload panel's capturable list. Collapse it here so
  // the state converges regardless of manifest freshness, then best-effort drop
  // the now-orphaned bare content dir (the canonical @owner/slug dir is kept).
  const twins = collapsePublishedTwins(state)
  if (twins.removed.length > 0) {
    await writeState(state)
    for (const key of twins.removed) {
      try {
        await rm(skillContentDir(key), { recursive: true, force: true })
      } catch {
        // Best-effort: an un-removable orphan dir is harmless — nothing keys it.
      }
    }
  }

  if (opts.bundledCreateSkillDir) {
    try {
      await ensureBundledCreateSkill(opts.bundledCreateSkillDir, opts.bundledCreateSkillMd)
      // Same pre-ensure-snapshot refresh as the router below: without it the
      // first sync after a playbook change reads the fresh store bytes as local
      // drift and skips materializing until the next sync.
      const refreshed = await readState()
      const createEntry = refreshed.skills[BUNDLED_CREATE_SLUG]
      if (createEntry) state.skills[BUNDLED_CREATE_SLUG] = createEntry
      else delete state.skills[BUNDLED_CREATE_SLUG]
    } catch {
      // Best-effort: the bundled meta-skill must not block sync.
    }
  }

  if (opts.bundledRouteSkillDir) {
    try {
      await ensureBundledRouteSkill(opts.bundledRouteSkillDir, opts.bundledRouteSkillMd)
      // ensureBundledRouteSkill rewrote the store AND persisted state for the
      // bundled route skill, but `state` above is a pre-ensure in-memory
      // snapshot. Refresh just that entry so the materialize loop verifies the
      // freshly-written store against the hash we just recorded. Without this,
      // the FIRST sync after any router-content change compares new store bytes
      // against the old snapshot hash, reads it as `integrity_failed: local
      // content hash drifted`, and skips materializing the update until the
      // next sync — so a shipped router change would not reach agents on the
      // sync that installed it.
      const refreshed = await readState()
      const routeEntry = refreshed.skills[BUNDLED_ROUTE_SLUG]
      if (routeEntry) state.skills[BUNDLED_ROUTE_SLUG] = routeEntry
      else delete state.skills[BUNDLED_ROUTE_SLUG]
    } catch {
      // Best-effort: the bundled meta-skill must not block sync.
    }
  }
  const materialized: SyncResult['materialized'] = []
  const failed: SyncResult['failed'] = []
  const pendingReview: SyncResult['pendingReview'] = []
  const customized: SyncResult['customized'] = []

  // Baseline for drift detection (R1/R2): entry {hash, version} BEFORE any pull
  // phase bumps them. Drift is measured against what sync last wrote to disk,
  // so an upstream update arriving this run is not misread as a hand edit —
  // and a hand edit sitting under an incoming update still is one. Hash and
  // version are snapshotted TOGETHER: the customized lineage is built from this
  // snapshot, so an update in the same run can't pair the post-pull version
  // with the pre-pull hash.
  const prePullSnapshots = new Map<string, { hash: string; version: number }>()
  for (const [slug, entry] of Object.entries(state.skills)) {
    prePullSnapshots.set(slug, { hash: entry.hash, version: entry.version })
  }

  // Load the update-trust policy and the user's own key ID once.
  // The policy drives the per-skill auto-apply vs diff-gate decision below;
  // ownKeyId lets self-published updates auto-apply regardless of policy.
  const policy = await loadPolicy(opts.policyPath)
  let ownKeyId: string | null = null
  try {
    ownKeyId = (await loadAuthorKey(configDir)).keyId
  } catch {
    // No own signing key configured yet — fine; nothing resolves as self.
  }

  // Resolve bearer via device.json, then session.json / env.
  const { token: effectiveToken, kind: bearerKind } = await loadRegistryBearer(opts.token)
  const effectiveTokenOrUndef = effectiveToken || undefined
  // This machine's device id — sent with the union pull so a session-authed CLI
  // still gets per-device kit routing (the manifest scopes to it server-side).
  const deviceId = (await readActiveDeviceFile())?.device_id
  const isKitKey = effectiveTokenOrUndef?.startsWith('skillet_k_') ?? false
  const approvePre = opts.approvePre === true || process.env['SKILLET_APPROVE_PRE'] === '1'
  const autoApprove = opts.autoApprove === true
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '')
  const effectivePinDir = pinDir ?? `${configDir.replace(/\/$/, '')}/skillet/pinned`
  const installClient = effectiveTokenOrUndef
    ? new RegistryClient({
        baseUrl: registryUrl,
        token: effectiveTokenOrUndef,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      })
    : null
  const installPinged = new Set<string>()

  // U7: account-scoped decisions are the source of truth. Pull them once
  // (best-effort) so they can drive the gate below: the account `update_mode`
  // sets the external global trust default, server-approved versions short-circuit
  // the prompt (and mirror into the local lock), and server rejections skip. On
  // any failure we fall back to the local lock — sync still runs and the on-device
  // signature + scan gates are unaffected (trust governs review, not safety).
  const approvedHashes = new Set<string>()
  const rejectedHashes = new Set<string>()
  // Kit removals awaiting a web decision (R5): manifest-absent but HELD from
  // pruning, keyed by canonical @owner/slug ref. Empty on older registries,
  // which restores the old prune-on-absence behavior.
  const heldRemovalRefs = new Set<string>()
  let accountUpdateMode: 'auto' | 'manual' | null = null
  // The account handle resolves "self" for web-first accounts with no local
  // signing key (see requiresApproval). Best-effort: offline, gate as before.
  let ownHandle: string | null = null
  if (installClient) {
    try {
      const acct = await installClient.getMyDecisions()
      accountUpdateMode = acct.update_mode
      for (const d of acct.decisions) {
        if (d.state === 'approved') approvedHashes.add(d.version_hash)
        else if (d.state === 'rejected') rejectedHashes.add(d.version_hash)
      }
      for (const id of acct.pending_removals ?? []) {
        const sep = id.indexOf(':')
        if (sep > 0) heldRemovalRefs.add(`@${id.slice(0, sep)}/${id.slice(sep + 1)}`)
      }
    } catch {
      // Offline or an older registry — fall back to the local lock.
    }
    ownHandle = (await installClient.whoami())?.handle ?? null
  }
  // Map the account mode onto the external global default (auto -> auto, manual ->
  // gate). Per-skill/author/kit overrides and per-kit subscriber_trust still win
  // above it in resolveTrustMode's precedence (R11). Own content stays auto.
  if (accountUpdateMode) {
    policy.globals.external = accountUpdateMode === 'auto' ? 'auto' : 'gate'
  }

  // Per-registry revocation: a delegated device key revoked on the registry that
  // serves a skill must block that skill, even if a different (default) registry
  // hasn't revoked it. Resolve the revocation set PER serving registry, memoized
  // so each distinct registry is queried once. Best-effort:
  // offline sync proceeds with an empty set.
  const revokedKeyCache = new Map<string, { ids: Set<string>; ok: boolean }>()
  const getRevokedKeys = async (
    url: string | undefined,
  ): Promise<{ ids: Set<string>; ok: boolean }> => {
    const key = (url ?? registryUrl).replace(/\/+$/, '')
    const cached = revokedKeyCache.get(key)
    if (cached) return cached
    let result = { ids: new Set<string>(), ok: true }
    try {
      result = await resolveRevokedDeviceKeyIds(state, key, {
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      })
    } catch {
      result = { ids: new Set<string>(), ok: false }
    }
    revokedKeyCache.set(key, result)
    return result
  }
  // Home-registry set for the single-registry union-manifest pull below.
  const homeRevocation = await getRevokedKeys(registryUrl)
  const revokedDeviceKeyIds = homeRevocation.ids

  // ------------------------------------------------------------------------
  // Phase 0a: union-manifest pull. When a token is configured, fetch
  // the server-side union manifest and add any skill refs from shared kits
  // that aren't in local state yet. Mutates state.skills in place.
  // This runs BEFORE the per-skill pull loop so new refs are present for the
  // materialize phase in the same run.
  // ------------------------------------------------------------------------
  const unionOutcomes: PullOutcome[] = []
  // The manifest's keep-set (refs) when the pull was an authoritative 200 — used
  // by the prune reconcile below. null on 304/401/error → never prune this run.
  let unionManifestRefs: Set<string> | null = null
  // Server's account-bound signal for the empty-manifest zero-out decision.
  let unionAccountScope: 'user' | undefined
  const notices: string[] = []
  if (effectiveToken && bearerKind === 'session' && !deviceId) {
    notices.push(
      'Per-device kit routing skipped — run `skillet connect` to link this machine.',
    )
  }

  // TCC policy (U2/U3): the skill store itself (SKILLET_DIR/skills) can
  // resolve into a protected folder (env-driven SKILLET_DIR). Assessed HERE,
  // before any pull phase: both pull phases content-read and write the store
  // (store-hash alignment, bundle writes), so a parked store must skip them
  // outright — not just the per-skill materialize loop below. Bundle bytes,
  // drift baselines, and store edits all live there too, so a parked store
  // parks every per-skill content read; skills converge on a later run that
  // can read it. Local-only: never a failure, never a wire-status change.
  // Same probing assessment as the adapter roots: a user-initiated run
  // unlocks the store; a suspended marker re-parks it.
  const storeParked = assessTccRoot(join(skilletDir(), 'skills')).parked
  if (storeParked) {
    notices.push(
      'Skill store is inside a macOS-protected folder (Documents, Desktop, or Downloads); skill content reads are parked this run.',
    )
  }

  const slugFilter =
    opts.slugs && opts.slugs.length > 0 ? new Set(opts.slugs) : null
  if (effectiveToken && !opts.skipPull && !storeParked) {
    const {
      outcomes: newRefOutcomes,
      manifestRefs,
      accountScope,
      authRejected,
    } = await pullFromUnionManifest(state, {
      registryUrl,
      token: effectiveToken,
      pinDir,
      revokedDeviceKeyIds,
      ...(deviceId ? { deviceId } : {}),
      etagCachePath: opts.etagCachePath,
      fetchImpl: opts.fetchImpl,
    })
    if (authRejected) {
      // Do not edit this message: older bundled desktop sidecars are detected by a
      // regex over this exact prose (the `machine_disconnected` code is the real
      // contract; the text is the fallback for sidecars that predate it).
      throw new RegistryError(
        'machine_disconnected',
        'This machine was disconnected from your account. Get a pair code at skillet.md → Settings → Devices and run `skillet connect <code>`.',
        401,
      )
    }
    unionManifestRefs = manifestRefs
    unionAccountScope = accountScope
    unionOutcomes.push(...newRefOutcomes)
    for (const o of newRefOutcomes) {
      if (o.status === 'failed') {
        failed.push({ slug: o.slug, reason: o.reason ?? 'union_pull_failed' })
      }
    }
  }

  // ------------------------------------------------------------------------
  // Phase 0b: pull updates from the registry for every registry-sourced
  // entry that was already in local state before this run (or just added above
  // with the same hash). Mutates state.skills in place so the materialize loop
  // below sees the new bytes + signature + author identity in this same run,
  // and the graded-diff approval gate fires for whatever just arrived.
  //
  // The headless rule maps directly to the pullMode/TTY check:
  //   - interactive → pull all non-pinned entries
  //   - unattended  → skip pull entirely (pinned bytes already on disk)
  // Kit-key tokens always run unattended unless pullMode is explicitly set.
  // ------------------------------------------------------------------------
  const interactive =
    opts.pullMode === 'interactive'
      ? true
      : opts.pullMode === 'unattended' || isKitKey
        ? false
        : opts.checkOnly === true
          ? true
          : (output as NodeJS.WriteStream).isTTY === true
  const pullOutcomes: PullOutcome[] = []
  if (!opts.skipPull && !storeParked) {
    pullOutcomes.push(
      ...(await pullRegistryUpdates(state, {
        interactive,
        pinDir,
        etagCachePath: opts.etagCachePath,
        token: effectiveToken,
        // Per-registry revocation (each entry checked against its serving registry).
        getRevokedKeys: async (url) => (await getRevokedKeys(url)).ids,
        fetchImpl: opts.fetchImpl,
      })),
    )
    for (const o of pullOutcomes) {
      if (o.status === 'failed') {
        // Surface pull failures alongside materialize failures so a CI run
        // that can't refresh from the registry still exits non-zero. The
        // pre-existing on-disk bytes are still materialized below — never
        // delete an approved version because the network broke.
        failed.push({ slug: o.slug, reason: o.reason ?? 'pull_failed' })
      }
    }
  }

  // Skills whose bytes changed this run (an UPSTREAM update). Their on-disk copy
  // legitimately differs from the freshly-bumped entry.hash — that's not a user
  // edit, so fork-on-edit must skip them (the graded-diff/materialize path owns
  // the update). Without this, an update would be misread as an edit and forked.
  const updatedRefs = new Set<string>()
  for (const o of unionOutcomes) if (o.status === 'updated') updatedRefs.add(o.slug)
  for (const o of pullOutcomes) if (o.status === 'updated') updatedRefs.add(o.slug)

  // F6: a pull that reports a version yanked flags any customized skill HOLDING
  // that version as a held update, so it stops nudging and takeUpstream refuses
  // it. Runs BEFORE the materialize loop so the customized branch's held-update
  // reconcile sees the flag (it leaves a same-hash record untouched).
  if (!opts.checkOnly) {
    for (const o of [...unionOutcomes, ...pullOutcomes]) {
      if (!o.yankedHash) continue
      const e = state.skills[o.slug]
      if (e?.held_update && e.held_update.hash === o.yankedHash && !e.held_update.yanked) {
        e.held_update = { ...e.held_update, yanked: true }
        e.updatedAt = new Date().toISOString()
        await upsertSkill(e)
        state.skills[o.slug] = e
      }
    }
  }

  if (opts.checkOnly === true) {
    const changed =
      pullOutcomesIndicateWork(unionOutcomes) ||
      pullOutcomesIndicateWork(pullOutcomes) ||
      manifestPruneWouldRun(state, unionManifestRefs, bearerKind, !!opts.skipPull) ||
      (await pendingGatedMaterialize(
        state,
        policy,
        ownKeyId,
        effectivePinDir,
        approvalLockPath,
        approvedHashes,
        rejectedHashes,
        ownHandle,
      ))
    return {
      materialized: [],
      adapters: [],
      failed,
      pendingReview,
      pull: pullOutcomes,
      unionPull: unionOutcomes,
      pruned: [],
      localized: [],
      trashDir: null,
      customized: [],
      lockPath: join(cwd, 'skillet.lock'),
      notices,
      changed,
    }
  }

  // Security gate runs against every adapter, including ones we will skip:
  // declared roots must be in the per-runtime allowlist before we even ask
  // the adapter whether its runtime is present. Project-scoped adapters
  // (kind="project") are validated against PROJECT_TARGET_ALLOWLIST + the
  // cwd; global adapters against MATERIALIZATION_ROOT_ALLOWLIST.
  for (const adapter of adapters) {
    validateAdapterRoot(adapter, { cwd })
  }

  // detect() per adapter. Undetected runtimes report skipped-not-detected and
  // are excluded from materialization. Detected runtimes get an in-progress
  // entry whose status is upgraded to "materialized" or "failed" below.
  // Baseline adapters (universal `.agents/skills`) bypass detect when named in
  // opts.baselineAdapterNames.
  const baselineSet = new Set(opts.baselineAdapterNames ?? [])
  // TCC policy (U2/U3): global adapters whose root RESOLVES into a macOS
  // protected folder (~/Documents, ~/Desktop, ~/Downloads) are PARKED this
  // run unless this invocation may read them. They stay detected (detection
  // is metadata-only, prompt-free), stay in the reported agent set, and stay
  // in the expected-adapter accounting, but no content read or write touches
  // their root. Because a parked adapter never "succeeds", materialized_hash
  // cannot advance past it, so pending skills converge on a later sync that
  // can read the root instead of being misclassified as hand edits. Computed
  // over ALL adapters (not just detected) so the drift/stash passes below can
  // consult it too.
  //
  // U3: assessTccRoot is the probing form of the gate — a user-initiated run
  // performs the one TCC-gated read here (macOS may prompt once, with the
  // bundle usage string) and records the per-root unlock marker on success; a
  // background run holding an active same-context marker verifies it still
  // works, and a permission failure suspends the marker and re-parks the root
  // BEFORE any per-skill work (no edit_unreadable spam).
  const parkedAdapterNames = new Set<string>()
  const deniedAdapterNames = new Set<string>()
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue
    const access = assessTccRoot(adapter.targetDir)
    if (access.parked) {
      parkedAdapterNames.add(adapter.name)
      if (access.denied) deniedAdapterNames.add(adapter.name)
    }
  }
  const results: AdapterResult[] = []
  const active: Adapter[] = []
  for (const adapter of adapters) {
    let detected = false
    const forceBaseline = baselineSet.has(adapter.name)
    try {
      detected = forceBaseline ? true : await adapter.detect()
    } catch (err) {
      results.push({
        name: adapter.name,
        status: 'failed',
        targetDir: adapter.targetDir,
        count: 0,
        paths: [],
        error: `detect() threw: ${(err as Error).message}`,
        warnings: [],
      })
      continue
    }
    if (!detected) {
      results.push({
        name: adapter.name,
        status: 'skipped-not-detected',
        targetDir: adapter.targetDir,
        count: 0,
        paths: [],
        warnings: [],
      })
      continue
    }
    const parkedRoot = parkedAdapterNames.has(adapter.name)
    const deniedRoot = deniedAdapterNames.has(adapter.name)
    results.push({
      name: adapter.name,
      status: 'materialized',
      targetDir: adapter.targetDir,
      count: 0,
      paths: [],
      warnings: parkedRoot
        ? [
            deniedRoot
              ? `${adapter.name}: folder access was denied; allow Skillet in System Settings under Privacy and Security, then sync again`
              : `${adapter.name}: skills folder resolves into a macOS-protected folder (Documents, Desktop, or Downloads); Skillet parked reads and writes there this run`,
          ]
        : [],
      ...(parkedRoot ? { parked: true } : {}),
      ...(deniedRoot ? { parkedDenied: true } : {}),
    })
    active.push(adapter)
  }

  // Report detected runtimes NOW, not at the end of the run: everything after
  // this point can throw (approval gate, materialize failures), and a machine
  // whose sync is blocked still HAS these runtimes — without the early send,
  // the web device row read "No runtimes yet" for as long as an update sat
  // unapproved. Fail-silent and unawaited, same as the late reports.
  pingDeviceAgents({
    registryUrl,
    token: effectiveToken,
    bearerKind,
    agents: active.map((a) => a.name),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })

  const resultByName = new Map(results.map((r) => [r.name, r] as const))
  const materializeErrors = new Map<string, number>()

  // Reconcile/prune: make this machine match your manifest. Skills you
  // unsubscribed from or routed off this device left the manifest; move their
  // Skillet-written, unedited copies to the local trash (reversible). Runs
  // BEFORE materialize so pruned entries are gone from state and aren't rewritten.
  // Gated to the full-account union (session/device) — a kit-key manifest is a
  // single kit and pruning against it would wrongly remove everything else.
  // Returns data only (no printing here) so `--json` output stays clean — the
  // CLI/desktop format `pruned`/`localized`/`trashDir` for their surface.
  let pruned: SyncResult['pruned'] = []
  let localized: SyncResult['localized'] = []
  let trashDir: string | null = null
  if (
    !opts.skipPull &&
    unionManifestRefs &&
    (bearerKind === 'session' || bearerKind === 'device')
  ) {
    // Zero-out (empty manifest deletes everything) is allowed only for an
    // account-bound caller. Prefer the server's `account_scope` signal so a
    // BOUND DEVICE that routed off every kit can zero out too; fall back to the
    // session-only heuristic when an older server omits the field. Any
    // unrecognized scope from an older registry never zeroes out.
    const allowZeroOut = zeroOutAllowed(unionAccountScope, bearerKind)
    // Snapshot the key set BEFORE prune so we can tell whether reconcilePrune
    // actually mutated `state` (any removal or fork-swap) and only write when it did.
    const keysBefore = Object.keys(state.skills).sort().join('\u0000')
    // Pass ALL configured global adapters (not just detected ones) so a copy in
    // any runtime is accounted for. Project-scoped adapters are skipped inside
    // reconcilePrune — their per-repo copies are never pruned by an account sync.
    const rec = await reconcilePrune(state, unionManifestRefs, adapters, {
      allowZeroOut,
      prePullSnapshots,
      holdRefs: heldRemovalRefs,
      parkedAdapterNames,
    })
    pruned = rec.pruned
    localized = rec.localized
    trashDir = rec.trashDir
    // reconcilePrune mutates `state` in place: it `delete`s pruned/orphaned
    // entries AND rewrites localized (customized → local) entries. Those
    // mutations live ONLY in memory — `upsertSkill` (below) read-modify-writes
    // the on-disk state.json one entry at a time, so a stale read would re-add
    // the just-removed skills (and drop the localization) on the next sync.
    // Persist the reconciled state now, before the upsert loop re-reads disk, so
    // the changes stick. We write `state` — the same object loaded at the top of
    // sync — which matches upsertSkill's read-modify-write window, so no new race
    // is introduced. The key-set guard covers removals; `localized` covers the
    // in-place rewrites that leave the key set unchanged.
    if (localized.length > 0 || Object.keys(state.skills).sort().join('\u0000') !== keysBefore) {
      await writeState(state)
    }
  }
  // Age out old trash (best-effort; never blocks or breaks sync).
  void clearOldTrash()

  // Drop/refresh the store-root README so the editable-copy folder is
  // self-explanatory (best-effort; never block sync).
  if (!storeParked) await ensureSkillStoreReadme().catch(() => {})

  // One-time migrations off retired layouts (best-effort; never block sync).
  // Codex legacy `~/.codex/skills` duplicates: global, runs once per sync.
  // Skipped while the store is parked (the ours-and-unedited check reads
  // store bundles).
  if (!storeParked) await cleanupLegacyCodexSkills(state, notices).catch(() => {})
  // Old Windsurf project rule files in this cwd, now that windsurf is global.
  if (active.some((a) => a.name === 'windsurf')) {
    await cleanupLegacyWindsurfArtifacts(cwd).catch(() => {})
  }

  for (const [slug, entry] of Object.entries(state.skills)) {
    if (slugFilter) {
      if (!slugFilter.has(slug)) continue
    } else if (!isKitSyncedSkill(entry) && !isSkilletSystemSkill(entry)) {
      continue
    }

    const owner = entry.owner ?? null
    const identity = skillMaterializeIdentity(slug, owner)
    const adapterSlug = identity.adapterSlug

    // ── Customized skills (KTD1/KTD2/KTD3): the edit stays LIVE ──────────────
    // A customized skill is never materialized over — its edit is the live one.
    // Reconcile the held-update signal against the freshly-pulled upstream hash
    // (`entry.hash` after the pull phase) and move on; no verify, no gate, no
    // materialize touches the folder.
    if (entry.customized_from) {
      if (reconcileHeldUpdate(entry)) {
        await upsertSkill(entry)
        state.skills[slug] = entry
      }
      customized.push({ slug, hasUpdate: heldUpdateSurfaces(entry) })
      continue
    }

    // TCC policy (U2): with the store parked, every remaining step for this
    // skill is a content read (store drift, bundle bytes, adapter trees).
    // Skip it — no failure, no state change — and converge on a later run.
    if (storeParked) continue

    // Drift baseline (R2 + F1): the hash sync LAST SUCCESSFULLY MATERIALIZED to
    // this machine. `entry.hash` is advanced by this run's pull BEFORE we
    // materialize, so a pull that persisted a new version whose materialize then
    // failed/declined (degrade-never-delete) leaves the OLD author bytes on disk
    // while state records the new hash. Baselining on `materialized_hash` (what
    // actually landed) means that lag is seen as "not yet materialized" and
    // RE-MATERIALIZES (converges) below — never a phantom edit that customizes
    // the skill forever. Fall back to the pre-pull snapshot (legacy state with no
    // materialized_hash yet), then the incoming hash for a first-seen entry.
    const snapshot = prePullSnapshots.get(slug)
    const driftBaseline = entry.materialized_hash ?? snapshot?.hash ?? entry.hash
    const detection = await detectDriftedGlobalCopies(adapters, adapterSlug, owner, driftBaseline)

    // ── Store edit (KTD1/KTD3): the STORE copy is a GLOBAL edit ───────────────
    // The store (`~/.skillet/skills/<slug>`) is where the desktop viewer's
    // "Folder" sends a human. An edit there is the skill's new version on EVERY
    // runtime, so unlike a per-runtime adapter edit it PROPAGATES: we materialize
    // the edited store bytes to all adapters and mark the skill customized.
    //
    // A store edit is measured against what we last MATERIALIZED, never the
    // `entry.hash` fallback: without a `materialized_hash` we cannot tell a hand
    // edit from a pending author update (a grown bundle awaiting approval), so —
    // like RF1's `stable` guard — we never customize in that case.
    //
    // Two clauses identify the edit: the store diverged from the materialized
    // baseline AND from the recorded version (`entry.hash`). The second clause
    // separates a hand edit from a pulled-but-unmaterialized author version — a
    // clean pull writes `entry.hash` bytes to the store, so its store hash equals
    // `entry.hash` and this branch does not fire (it re-materializes to converge
    // below). It also lets an edit that coincides with an upstream pull (store
    // held by the pre-pull guard) still propagate, which `stable` would miss.
    const storeBaseline = entry.materialized_hash
    const storeDrift =
      storeBaseline != null ? await detectStoreDrift(slug, storeBaseline) : null
    const isStoreEdit =
      storeDrift != null &&
      storeDrift.drifted &&
      storeDrift.hash !== null &&
      storeDrift.hash !== entry.hash
    if (storeDrift?.uncapturable) {
      const reason = `edit_unreadable: the local store copy of "${slug}" could not be read (${storeDrift.code ?? 'unknown'}); left untouched`
      if (!quietSkipLines) {
        ;(output as NodeJS.WriteStream).write(`Skipped "${slug}" — ${reason}.\n`)
      }
      failed.push({ slug, reason })
      continue
    }
    if (isStoreEdit) {
      const editedHash = storeDrift!.hash!
      const lineage = { author: owner, slug, version: entry.version, hash: driftBaseline }

      // F5 — stash the AUTHOR baseline (bytes the edit was made FROM) so Restore
      // original can return it later. The store now holds the EDIT, so read the
      // baseline from a still-clean adapter copy (one not in `detection.drifted`).
      try {
        for (const adapter of adapters) {
          if (adapter.kind === 'project') continue
          // Parked roots (U2) are never content-read, even for a baseline stash.
          if (parkedAdapterNames.has(adapter.name)) continue
          if (detection.drifted.some((d) => d.adapter === adapter.name)) continue
          let dir: string
          try {
            dir = adapter.targetSkillDir(adapterSlug, { owner })
          } catch {
            continue
          }
          const tree = await readTreeIgnoringDotfiles(dir).catch(() => null)
          if (tree && tree.size > 0 && canonicalContentHash(tree) === driftBaseline) {
            await stashBaselineVersion(driftBaseline, tree)
            break
          }
        }
      } catch {
        // Best-effort: a missing/unreadable clean copy just means restore falls
        // back to upstream.
      }

      // Collision (KTD3): back up any adapter that INDEPENDENTLY drifted before we
      // overwrite it — store wins, but the agent's edit stays recoverable.
      if (detection.drifted.length > 0) {
        try {
          await backupSkillVersion({ lineage, copies: detection.drifted, reason: 'customize' })
        } catch {
          // Best-effort backup; overwriting still proceeds (store-wins dominates).
        }
      }

      // Materialize the edited store bytes to every active adapter. Self-authored
      // bytes, so this SKIPS the signature/approval/quarantine gates below — the
      // user editing their own store copy is the authority.
      const editBundle: DecodedBundle = await readBundleFromSkillStore(slug)
      let wroteEdit = false
      let expectedGlobalEdit = 0
      let succeededGlobalEdit = 0
      for (const adapter of active) {
        const isGlobal = adapter.kind !== 'project'
        if (isGlobal) expectedGlobalEdit += 1
        const result = resultByName.get(adapter.name)
        if (!result) continue
        // Parked root (U2): no write. Counted in expectedGlobalEdit but never
        // in succeededGlobalEdit, so the customized marker is not committed on
        // a run that could not reach every runtime (same convergence rule as
        // the AdapterSkipError path below).
        if (parkedAdapterNames.has(adapter.name)) continue
        const adapterCwd = await resolveAdapterMaterializeCwd(adapter, cwd)
        const entryDescription = entry.description?.trim() ? entry.description : undefined
        try {
          const writtenPaths = await adapter.materialize(
            adapterSlug,
            editBundle,
            materializeOptsForIdentity(identity, adapterCwd, { description: entryDescription }),
          )
          for (const dest of writtenPaths) {
            materialized.push({ slug, dest, hash: editedHash })
            result.paths.push(dest)
            wroteEdit = true
          }
          if (writtenPaths.length > 0 && !isSkilletSystemSkill(entry)) result.count += 1
          if (isGlobal) succeededGlobalEdit += 1
        } catch (err) {
          const message = (err as Error).message
          if (err instanceof AdapterSkipError) {
            result.warnings.push(`${adapter.name}: ${message}`)
            continue
          }
          failed.push({ slug, reason: `materialize_failed: ${adapter.name}: ${message}` })
          materializeErrors.set(adapter.name, (materializeErrors.get(adapter.name) ?? 0) + 1)
          result.error = `materialize(${slug}) failed: ${message}`
        }
      }

      // Only commit the customized marker on a FULL materialize (every global
      // adapter took the edit). A partial write leaves the skill un-customized so
      // the next sync re-enters this branch and converges — never a half-applied edit.
      if (wroteEdit && succeededGlobalEdit === expectedGlobalEdit) {
        const updated: SkillEntry = {
          ...entry,
          customized_from: lineage,
          materialized_hash: editedHash,
          updatedAt: new Date().toISOString(),
        }
        // A pulled-but-unapplied author version (entry.hash advanced past the
        // baseline the edit was made from) is HELD, not applied.
        if (entry.hash !== driftBaseline) {
          updated.held_update = { version: entry.version, hash: entry.hash }
        }
        await upsertSkill(updated)
        state.skills[slug] = updated
        customized.push({ slug, hasUpdate: heldUpdateSurfaces(updated) })
      }
      continue
    }

    // RF1 — a disk difference is a USER EDIT only when the skill is in a STABLE
    // state: state and disk agree on what should be there
    // (`materialized_hash === entry.hash`). When author bytes are PENDING —
    // `materialized_hash` missing (a legacy entry), or `!= entry.hash` (a pull
    // advanced the hash but the materialize failed / was partial / was declined) —
    // ANY on-disk difference is our OWN incomplete materialize, NOT a user edit.
    // In that case we must NOT customize; we fall through and (re-)materialize to
    // CONVERGE. This is what makes the multi-adapter partial-failure case heal:
    // next sync sees pending, re-materializes every runtime, and settles — instead
    // of freezing the skill customized off a runtime we simply hadn't caught up.
    const stable = entry.materialized_hash != null && entry.materialized_hash === entry.hash

    // First drift → mark customized, back up the edit, and LEAVE IT LIVE (R1).
    // No materialize runs for this skill: the edit is now the user's version.
    if (stable && detection.drifted.length > 0) {
      // The lineage is the version the edit was made FROM = the drift baseline.
      // Pair its version only when the snapshot names that same baseline hash.
      const baselineVersion =
        snapshot && snapshot.hash === driftBaseline ? snapshot.version : entry.version
      const lineage = { author: owner, slug, version: baselineVersion, hash: driftBaseline }
      // F5: stash the baseline author bytes so Restore original can later return
      // the version the edit was made FROM, even after an update is pulled. Only
      // possible while the skill store still holds those exact bytes (no update
      // overwrote them this run); otherwise restoreOriginal falls back to upstream.
      try {
        const storeBundle = await readBundleFromSkillStore(slug)
        if (canonicalContentHash(storeBundle) === lineage.hash) {
          await stashBaselineVersion(lineage.hash, storeBundle as unknown as Map<string, Buffer>)
        }
      } catch {
        // Best-effort: a missing/unreadable store just means restore falls back.
      }
      try {
        await backupSkillVersion({ lineage, copies: detection.drifted, reason: 'customize' })
      } catch {
        // Best-effort backup (R3): even if the backup write fails, the edit is
        // left live and the skill is still marked customized — R1 (never revert)
        // dominates R3 (back up). The next sync retries the backup on re-detect.
      }
      const updated: SkillEntry = {
        ...entry,
        customized_from: lineage,
        updatedAt: new Date().toISOString(),
      }
      // An upstream update that already arrived this run is HELD, not applied.
      if (entry.hash !== lineage.hash) {
        updated.held_update = { version: entry.version, hash: entry.hash }
      }
      await upsertSkill(updated)
      state.skills[slug] = updated
      customized.push({ slug, hasUpdate: heldUpdateSurfaces(updated) })
      continue
    }

    // An existing dir we cannot read/hash (uncapturable) may hold an edit we
    // cannot prove absent — never materialize over it (edit-preservation). Skip
    // and surface it; no escalation counter (the heal it once guarded is gone).
    if (detection.uncapturable.length > 0) {
      const code = detection.uncapturable[detection.uncapturable.length - 1]!.code
      const reason = `edit_unreadable: an existing on-disk copy of "${slug}" could not be read (${code ?? 'unknown'}); left untouched`
      if (!quietSkipLines) {
        ;(output as NodeJS.WriteStream).write(`Skipped "${slug}" — ${reason}.\n`)
      }
      failed.push({ slug, reason })
      continue
    }

    const bundle: DecodedBundle = await readBundleFromSkillStore(slug)
    let currentHash = skillContentHash(bundle)
    let entryForVerify = entry
    if (currentHash !== entry.hash) {
      const bundleWithBackups = await readBundleFromSkillStore(slug, {
        includeSkilletBackups: true,
      })
      const legacyHash = canonicalContentHash(bundleWithBackups)
      if (legacyHash === entry.hash) {
        await writeBundleToSkillStore(slug, stripSkilletBackupPaths(bundleWithBackups))
        entryForVerify = {
          ...entry,
          hash: currentHash,
          updatedAt: new Date().toISOString(),
        }
        await upsertSkill(entryForVerify)
        state.skills[slug] = entryForVerify
      }
    }

    const authorPinned = await isAuthorPinned(entryForVerify, slug, effectivePinDir)
    const needsApproval = requiresApproval(entryForVerify, policy, ownKeyId, authorPinned, ownHandle)

    if (needsApproval) {
      // Account-scoped decisions win on pull (server is source of truth): a
      // matching account approval short-circuits the prompt and is mirrored into
      // the local lock; an account rejection skips. The local lock is the
      // offline fallback.
      const serverApproved = approvedHashes.has(currentHash)
      const serverRejected = !serverApproved && rejectedHashes.has(currentHash)
      const locallyApproved = await checkLock(approvalLockPath, slug, entry.version, currentHash)

      // Mirror a server approval into the local cache so future offline runs are fast.
      if (serverApproved && !locallyApproved) {
        await recordApproval(approvalLockPath, slug, entry.version, {
          contentHash: currentHash,
          authorKeyId: entry.authorKeyId ?? '',
          approvedAt: new Date().toISOString(),
        })
      }

      const alreadyApproved = serverApproved || locallyApproved

      if (!alreadyApproved) {
        if (serverRejected) {
          if (!quietSkipLines) {
            ;(output as NodeJS.WriteStream).write(
              `Skipped "${slug}" — v${entry.version} was rejected. Approve it from the web or run \`skillet approve ${slug} --version ${entry.version}\`.\n`,
            )
          }
          continue
        }
        // Skip versions explicitly rejected via `skillet reject` — no diff, no prompt.
        const isRejected = await checkRejection(approvalLockPath, slug, entry.version)
        if (isRejected) {
          if (!quietSkipLines) {
            ;(output as NodeJS.WriteStream).write(
              `Skipped "${slug}" — v${entry.version} was rejected. Run \`skillet approve ${slug} --version ${entry.version}\` to override.\n`,
            )
          }
          continue
        }

        // Build diff against the adapters we'd actually write to (fan-out)
        // using the full bundle tree (all files, not just SKILL.md).
        const prev = await readCurrentMaterialized(identity, active, cwd, parkedAdapterNames)
        const next: Record<string, Buffer> = {}
        for (const adapter of active) {
          for (const [bundlePath, bytes] of bundle) {
            next[`${adapter.name}/${bundlePath}`] = Buffer.from(bytes)
          }
        }

        const isTTY = (output as NodeJS.WriteStream).isTTY === true
        // A parked root's contents are UNKNOWN, not absent (U2): an empty
        // walk with a parked adapter in play must not grade as a first
        // install — the skill may well be materialized inside the parked root.
        const anyActiveParked = active.some((a) => parkedAdapterNames.has(a.name))
        const isFirstInstall = Object.keys(prev).length === 0 && !anyActiveParked
        const skillRef = slug.startsWith('@')
          ? slug
          : entry.owner
            ? `@${entry.owner}/${adapterSlug}`
            : slug

        // Interactive sync holds anything unapproved instead of prompting:
        // what's on disk stays, and the caller renders result.pendingReview
        // as a one-line summary. Review + approval live in `skillet pending`
        // / `skillet approve`. A slug-scoped run (`skillet add`) still
        // confirms inline — the user is present and asked for exactly that
        // skill. Headless runs keep the hard-fail contract below.
        if (isTTY && !approvePre && !autoApprove && !slugFilter) {
          let range = 'new'
          if (!isFirstInstall) {
            const incoming = `v${entry.versionLabel ?? entry.version}`
            const last = await getLastApprovedVersion(approvalLockPath, slug)
            range = last !== null ? `v${last} → ${incoming}` : incoming
          }
          pendingReview.push({ slug, range })
          continue
        }

        const nextRel: Record<string, Buffer> = {}
        for (const [bundlePath, bytes] of bundle) {
          nextRel[bundlePath] = Buffer.from(bytes)
        }
        const diffText = isFirstInstall
          ? summarizeInstall(skillRef, next)
          : renderUpdateReview({
              prev,
              next: nextRel,
              adapterNames: active.map((a) => a.name),
              color: isTTY,
            }) || `(no materialized version found for "${slug}" — first install from registry)`

        // SKILLET_APPROVE_PRE=1 or opts.approvePre bypasses the
        // interactive prompt for headless kit-key runs.
        // opts.autoApprove covers `skillet add -y` and similar user flags.
        let approved: boolean
        if (approvePre) {
          approved = true
          ;(output as NodeJS.WriteStream).write(
            `Auto-approved "${slug}" via SKILLET_APPROVE_PRE.\n`,
          )
        } else if (autoApprove) {
          approved = true
        } else {
          approved = await promptApproval(
            diffText,
            output as import('stream').Writable,
            input as import('stream').Readable,
            isFirstInstall ? 'install' : 'update',
          )
        }

        if (!approved) {
          // Non-TTY or kit-key: caller must exit non-zero.
          const isCI = !!(process.env['CI'] || effectiveToken)
          if (isCI || !(output as NodeJS.WriteStream).isTTY) {
            throw new Error(
              `Skill "${slug}" update requires approval. Run interactively to review and approve, or set SKILLET_APPROVE_PRE=1.`,
            )
          }
          // TTY but user said no: skip materialization for this skill.
          if (!quietSkipLines) {
            ;(output as NodeJS.WriteStream).write(`Skipped "${slug}" — update not approved.\n`)
          }
          continue
        }

        // TOCTOU guard: re-read and re-hash before materializing.
        const verifyBundle = await readBundleFromSkillStore(slug)
        const verifyHash = skillContentHash(verifyBundle)
        if (verifyHash !== currentHash) {
          throw new Error(
            `TOCTOU: content of "${slug}" changed between approval and materialization. Re-run to re-review.`,
          )
        }

        // Record approval in the lock.
        await recordApproval(approvalLockPath, slug, entry.version, {
          contentHash: currentHash,
          authorKeyId: entry.authorKeyId ?? '',
          approvedAt: new Date().toISOString(),
        })
      }
    }

    // KTD7: in account auto-mode, record a source:auto decision for a freshly
    // auto-applied EXTERNAL update so the recently-applied feed is account-wide.
    // Write-path only (a POST, never a read); CI/APPROVE_PRE runs record nothing,
    // and a failed post just drops this run's history (still applies locally).
    if (
      accountUpdateMode === 'auto' &&
      !needsApproval &&
      updatedRefs.has(slug) &&
      !approvedHashes.has(currentHash) &&
      installClient &&
      !approvePre &&
      !autoApprove &&
      entry.owner &&
      entry.authorKeyId !== ownKeyId
    ) {
      try {
        await installClient.postApproval(`${entry.owner}:${adapterSlug}`, currentHash)
        approvedHashes.add(currentHash)
      } catch {
        // best-effort; unauthenticated/failed post just skips this run's history.
      }
    }

    // Quarantine gate — runs AFTER signature-derived approval but
    // BEFORE the integrity check + adapter writes. Quarantined versions
    // require explicit extra consent on top of the standard graded-diff
    // approval. Non-TTY runs without `allowQuarantined` skip with a reason.
    if (requiresQuarantineConsent(entry.scan)) {
      const isTTY = (output as NodeJS.WriteStream).isTTY === true
      let allow = false
      if (allowQuarantined || allowQuarantinedSlugs.includes(slug)) {
        allow = true
        ;(output as NodeJS.WriteStream).write(
          allowQuarantined
            ? `Applying quarantined "${slug}" (pre-approved via --allow-quarantined).\n`
            : `Applying quarantined "${slug}" (consented during review).\n`,
        )
      } else if (isTTY) {
        allow = await promptQuarantineConsent(
          entry.scan!,
          slug,
          output as import('stream').Writable,
          input as import('stream').Readable,
        )
      }
      if (!allow) {
        const reason = `quarantined: harm scan flagged this version (status=${entry.scan?.status}); extra consent required`
        if (!quietSkipLines) {
          ;(output as NodeJS.WriteStream).write(`Skipped "${slug}" — ${reason}.\n`)
        }
        failed.push({ slug, reason })
        continue
      }
    }

    // Integrity gate (PROTOCOL §6.4 + acceptance criterion 3) — runs AFTER
    // approval but BEFORE any adapter writes. A failure here means the
    // bytes Skillet is about to materialize cannot be tied to the pinned
    // author key; we abort this skill and leave prior on-disk files alone.
    const revocation = await getRevokedKeys(entry.registryUrl)
    const reason = await verifyForMaterialize(
      entryForVerify,
      currentHash,
      effectivePinDir,
      // Check this entry against the revocation set of the registry that served
      // it (per-registry), not a single default-registry set.
      {
        revokedDeviceKeyIds: revocation.ids,
        revocationFetchOk: revocation.ok,
      },
    )
    if (reason !== null) {
      if (!quietSkipLines) {
        const msg = `Skipped "${slug}" — ${reason}. Existing materialized files left untouched.\n`
        ;(output as NodeJS.WriteStream).write(msg)
      }
      failed.push({ slug, reason })
      continue
    }

    // Degrade-never-delete: a single adapter failure must not abort
    // the run. Catch per (adapter, skill) and continue siblings; adapter
    // status is finalized after all skills are processed.
    //
    // RF2: track per-adapter success across the GLOBAL adapters so
    // `materialized_hash` only advances when EVERY global adapter took the bytes.
    // If ANY global adapter failed (this skill or earlier this run), the on-disk
    // set is not uniformly the new version, so recording the new hash would let
    // the next run's RF1 drift baseline treat the lagging runtime as a user edit.
    // (Project adapters don't participate in global drift, so they don't gate it —
    // when there are no global adapters `expectedGlobal === 0` and this is vacuous.)
    let wroteSkill = false
    let expectedGlobal = 0
    let succeededGlobal = 0
    for (const adapter of active) {
      const isGlobal = adapter.kind !== 'project'
      if (isGlobal) expectedGlobal += 1
      const result = resultByName.get(adapter.name)
      if (!result) continue
      // Parked root (U2): no content write this run. The adapter stays in
      // expectedGlobal but never succeeds, so materialized_hash below cannot
      // advance past it — the skill stays pending and a later sync that can
      // read the root re-materializes and converges (mirrors AdapterSkipError).
      if (parkedAdapterNames.has(adapter.name)) continue
      const adapterCwd = await resolveAdapterMaterializeCwd(adapter, cwd)
      const entryDescription = entry.description?.trim() ? entry.description : undefined
      try {
        // cwd is forwarded so project-scoped adapters (Cursor, Windsurf)
        // can resolve their root; global adapters ignore it.
        const writtenPaths = await adapter.materialize(
          adapterSlug,
          bundle,
          materializeOptsForIdentity(identity, adapterCwd, {
            description: entryDescription,
          }),
        )
        for (const dest of writtenPaths) {
          materialized.push({ slug, dest, hash: currentHash })
          result.paths.push(dest)
          wroteSkill = true
        }
        // One increment per skill, not per written file: the sync summary
        // renders this as "N skills" (a multi-file skill is still one skill).
        // Exclude the bundled `/skillet` router — it's materialized into every
        // agent as plumbing but is never a user-visible skill, so the per-agent
        // tally must match `skillet list` and the "Synced N kit skill(s)" line.
        if (writtenPaths.length > 0 && !isSkilletSystemSkill(entry)) {
          result.count += 1
        }
        if (isGlobal) succeededGlobal += 1
      } catch (err) {
        const message = (err as Error).message
        // A detected-but-not-ready adapter (e.g. installed-but-never-launched:
        // its config root is absent) throws AdapterSkipError. That is a benign
        // skip, not a materialize failure: surface it as a warning and leave
        // the skill pending (succeededGlobal stays short of expectedGlobal, so
        // the hash isn't advanced and the next run retries). It must NOT enter
        // `failed`/`materializeErrors`, or import/sync would exit non-zero over
        // an agent the user simply hasn't opened yet.
        if (err instanceof AdapterSkipError) {
          result.warnings.push(`${adapter.name}: ${message}`)
          continue
        }
        failed.push({
          slug,
          reason: `materialize_failed: ${adapter.name}: ${message}`,
        })
        materializeErrors.set(adapter.name, (materializeErrors.get(adapter.name) ?? 0) + 1)
        result.error = `materialize(${slug}) failed: ${message}`
      }

      // Nested-SKILL.md notice: OpenClaw discovers SKILL.md recursively, so a
      // bundle that ships a SKILL.md below its root registers extra phantom
      // skills. Faithful materialization is still correct (real bundles nest
      // legitimately — the cloudflare mirror ships eleven), so this informs
      // rather than blocks (Cursor .mdc precedent).
      if (adapter.name === 'openclaw') {
        const nested = [...bundle.keys()].filter(
          (p) => p !== 'SKILL.md' && p.endsWith('/SKILL.md'),
        )
        if (nested.length > 0) {
          notices.push(
            `"${slug}" bundles ${nested.length} nested SKILL.md file(s) (${nested.join(', ')}); OpenClaw discovers each as a separate skill.`,
          )
        }
      }

      // Surface higher-precedence shadows so a Skillet sync that
      // succeeded on disk but is silently overridden by a workspace skill
      // doesn't read as "your skills are everywhere" when they aren't.
      // findShadows is opt-in; adapters that don't implement it are skipped.
      if (adapter.findShadows) {
        try {
          const findings = await adapter.findShadows(adapterSlug, {
            owner: identity.owner,
            dirName: identity.dirName,
            workspaceDir: adapterCwd,
          })
          for (const f of findings) {
            result.warnings.push(
              `"${slug}" is shadowed by ${f.location} (${f.path}) — that copy will load instead of the Skillet-synced version.`,
            )
          }
        } catch {
          // Shadow detection is informational; never break sync.
        }
      }
    }

    if (wroteSkill && slug === BUNDLED_ROUTE_SLUG) {
      await removeLegacyBundledRouteMaterialization(active)
    }

    if (wroteSkill && installClient && entry.source === 'registry' && !installPinged.has(slug)) {
      installPinged.add(slug)
      pingInstallMetric(installClient, slug)
    }

    // F1/RF2: record what actually landed on disk. `materialized_hash` is only
    // written after a successful materialize (wroteSkill) AND when EVERY global
    // adapter took the bytes (`allGlobalMaterialized`), so neither a persisted-
    // but-unmaterialized pull nor a PARTIAL materialize (one runtime wrote vNew,
    // another still has vOld) poisons the next run's drift baseline. Leaving the
    // hash un-advanced on a partial keeps the skill in RF1's pending state, so the
    // next sync re-materializes the lagging runtime and converges. Gating on
    // `wroteSkill` also stops a store hash from being recorded when nothing wrote.
    const allGlobalMaterialized = succeededGlobal === expectedGlobal
    if (
      wroteSkill &&
      allGlobalMaterialized &&
      (currentHash !== entry.hash || entry.materialized_hash !== currentHash)
    ) {
      const updated: SkillEntry = {
        ...entry,
        hash: currentHash,
        materialized_hash: currentHash,
        updatedAt: new Date().toISOString(),
      }
      await upsertSkill(updated)
      state.skills[slug] = updated
    }
  }

  for (const adapter of active) {
    const result = resultByName.get(adapter.name)
    if (!result) continue
    const errors = materializeErrors.get(adapter.name) ?? 0
    if (result.count > 0) {
      result.status = 'materialized'
    } else if (errors > 0) {
      result.status = 'failed'
    } else {
      result.status = 'materialized'
    }
  }

  // Build per-slug overrides for the lockfile from the in-memory state so
  // each registry-sourced entry pins its author_key + signature into
  // skillet.lock for CI verification on a fresh clone (PROTOCOL §11).
  const overrides: Parameters<typeof writeLockFile>[3] = {}
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (entry.source === 'registry' && entry.authorKeyId && entry.signature) {
      overrides[slug] = {
        author_key: entry.authorKeyId,
        signature: entry.signature,
      }
    }
  }
  const lockPath = await writeLockFile(cwd, kitSyncedState(state), undefined, overrides)

  // First sync discloses what's recorded (honest default-on), then never again.
  // Read disclosure state BEFORE disclosing: the per-skill availability send
  // below is suppressed until the user has actually seen the disclosure, so no
  // skill list ever leaves the machine ahead of the notice.
  const alreadyDisclosed = (await activityState()).disclosed
  if (detectInitiator() === 'human') void maybeDiscloseActivity()
  recordEvent('sync', detectInitiator(), {
    count: materialized.length,
    adapterCount: adapters.length,
    detectedCount: active.length,
    failedAdapters: results.filter((r) => r.status === 'failed').length,
    failedSkills: failed.length,
  })

  // Cross-vendor distribution (availability): which skills are now present in
  // which runtimes on this machine. Sent separately from the lean sync event so
  // the event log never carries a skill list; opt-out-aware and fail-silent.
  // Held back on the first (pre-disclosure) sync — disclosure precedes the send.
  if (alreadyDisclosed) {
    void reportAvailability(
      [...new Set(materialized.map((m) => m.slug))],
      mergeAvailabilityRuntimes(
        active.map((a) => a.name),
        opts.readerRuntimes,
      ),
    )
  }

  pingDeviceMaterializations({
    registryUrl,
    token: effectiveToken,
    bearerKind,
    materializations: deriveMaterializations({ materialized, adapters: results, failed }),
    // Currently-customized skills ride the same report (KTD2): ref + baseline
    // only, reconciled to exactly this set on the registry (absence clears).
    edited: deriveEditedSkills(state.skills),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })

  return {
    materialized,
    adapters: results,
    failed,
    pendingReview,
    pull: pullOutcomes,
    unionPull: unionOutcomes,
    pruned,
    localized,
    trashDir,
    customized,
    lockPath,
    notices,
  }
}

// Compatibility: skillContentPath is still re-exported for adapters / tests
// that want the single-file entrypoint on disk.
export { skillContentPath }
