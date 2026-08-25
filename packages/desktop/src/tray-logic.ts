/** Pure tray helpers — testable without Tauri or DOM paint. */

export type Skill = {
  slug: string
  name: string
  description: string
  owner: string | null
  source: string
  sourceKit?: string | null
  synced?: boolean
  pinned: boolean
  body: string
  /** Classified category key (from the sync manifest) — drives the cover art. */
  category?: string | null
  /** Absolute path to this skill's SKILL.md on disk (from the CLI list). */
  path?: string | null
}

export type KitGroup = { kitRef: string | null; synced: boolean; skills: string[] }

export type KitStatus = { skills: Skill[]; groups: KitGroup[] }

export type SyncKitSkillJson = {
  slug: string
  status: 'synced' | 'skipped' | 'planned'
  reason?: string
}

export type SyncKitGroupJson = {
  kitRef: string
  skills: SyncKitSkillJson[]
}

export function syncKitsFromListFallback(kit: KitStatus | null): SyncKitGroupJson[] {
  if (!kit) return []
  return kit.groups
    .filter((g) => g.kitRef !== null)
    .map((g) => ({
      kitRef: g.kitRef as string,
      skills: g.skills.map((slug) => ({ slug, status: 'synced' as const })),
    }))
}

export function resolveTraySyncKits(
  kit: KitStatus | null,
  lastSyncKits: SyncKitGroupJson[] | null | undefined,
): SyncKitGroupJson[] {
  if (lastSyncKits?.length) return lastSyncKits
  return syncKitsFromListFallback(kit)
}

export function capturableSkills(skills: Skill[]): Skill[] {
  return skills.filter((s) => s.source === 'local' && !s.owner)
}

/** One scan finding, as carried on the widened upload envelope (KTD5). Core
 *  emits exactly `{file, line, category}` (see upload-skills.ts `toUploadFindings`). */
export interface UploadFinding {
  file: string
  line: number
  category: string
}

/** Findings grouped by the skill they belong to — the unit both the warn
 *  (published-but-flagged) and blocked (refused) channels carry, so the view can
 *  attribute a row to its skill in a multi-skill batch. */
export type UploadFindingGroup = { slug: string; findings: UploadFinding[] }

/** Parsed `skillet upload --json` envelope (core's UploadLocalSkillsResult).
 *  `warnings` and `failed[].findings` are optional (additive, KTD5) — an older
 *  CLI that omits them must still parse. */
export interface UploadResultJson {
  ok: boolean
  empty?: boolean
  published?: Array<{ slug: string; alreadyExists: boolean }>
  failed?: Array<{ slug: string; error: string; findings?: UploadFinding[] }>
  warnings?: Array<{ slug: string; findings: UploadFinding[] }>
  error?: string
}

export type UploadOutcome =
  | { kind: 'empty' }
  | { kind: 'error'; message: string; blocked?: UploadFindingGroup[] }
  | {
      kind: 'partial'
      message: string
      publishedSlugs: string[]
      warnings?: UploadFindingGroup[]
      blocked?: UploadFindingGroup[]
    }
  | { kind: 'success'; publishedSlugs: string[]; warnings?: UploadFindingGroup[] }

/** Non-empty per-skill warnings (published-but-flagged) from the envelope;
 *  undefined when none so callers/tests can assert the absence path. */
function collectWarnings(res: UploadResultJson): UploadFindingGroup[] | undefined {
  const groups = (res.warnings ?? []).filter((w) => w.findings && w.findings.length > 0)
  return groups.length > 0 ? groups : undefined
}

/** Per-skill blocked findings (failed uploads that carry structured findings —
 *  a registry `scan_blocked` refusal); undefined when none. */
function collectBlocked(res: UploadResultJson): UploadFindingGroup[] | undefined {
  const groups = (res.failed ?? [])
    .filter((f) => f.findings && f.findings.length > 0)
    .map((f) => ({ slug: f.slug, findings: f.findings! }))
  return groups.length > 0 ? groups : undefined
}

/**
 * Classify an upload result for the view. Partial failure is its own outcome
 * (R9): at least one skill published AND at least one failed must never render
 * as plain success — the user sees the split and the first reason.
 *
 * Two finding channels ride along, both visibility-independent (the registry is
 * the scan authority): `warnings` = published-but-flagged skills (non-blocking),
 * `blocked` = skills the registry refused (`scan_blocked`). A partial batch can
 * carry both; the view lists the blocked ones (what to fix) with priority.
 */
export function uploadOutcome(
  res: UploadResultJson,
  humanize: (msg: string) => string,
): UploadOutcome {
  if (!res.ok) {
    if (res.empty) return { kind: 'empty' }
    const fail = res.failed?.[0]
    const blocked = collectBlocked(res)
    return {
      kind: 'error',
      message: fail ? humanize(fail.error) : humanize(res.error ?? 'Upload failed.'),
      ...(blocked ? { blocked } : {}),
    }
  }
  const publishedSlugs = (res.published ?? []).map((p) => p.slug)
  const failed = res.failed ?? []
  const warnings = collectWarnings(res)
  if (failed.length > 0) {
    const blocked = collectBlocked(res)
    // When every failure carries scan findings, the findings list below the
    // message shows what and where — the message keeps to the counts instead
    // of triple-nesting the first error's prose. Failures without findings
    // (network, auth) still surface their reason: it's the only signal.
    const allBlocked = (blocked?.length ?? 0) === failed.length
    return {
      kind: 'partial',
      message: allBlocked
        ? `Uploaded ${publishedSlugs.length}. ${failed.length} blocked.`
        : `Uploaded ${publishedSlugs.length}. ${failed.length} failed: ${humanize(failed[0]!.error)}`,
      publishedSlugs,
      ...(warnings ? { warnings } : {}),
      ...(blocked ? { blocked } : {}),
    }
  }
  return { kind: 'success', publishedSlugs, ...(warnings ? { warnings } : {}) }
}

export function shouldRunTrayOpenCheck(
  now: number,
  lastCheckAt: number,
  minGapMs: number,
): boolean {
  return now - lastCheckAt >= minGapMs
}

export function shouldFallbackSyncOnCheckError(
  now: number,
  lastAutoSync: number,
  dailyGapMs: number,
): boolean {
  return now - lastAutoSync >= dailyGapMs
}

export function humanizeAppError(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const msg = lines[0] ?? raw.trim()
  if (/unknown command/i.test(msg)) {
    return 'Upload is not in this app build yet. Quit Skillet, rebuild from the latest source, and try again.'
  }
  if (/json parse error/i.test(raw) || /returned no json/i.test(raw) || /unexpected cli output/i.test(raw)) {
    return 'Something went wrong talking to Skillet. Quit and reopen the app, then try again.'
  }
  if (/not_authenticated|session publish requires/i.test(msg)) {
    return 'Sign in again with a fresh pair code from skillet.md → Settings → Devices.'
  }
  if (/already used/i.test(msg)) {
    return 'That code was already used. Generate a new one on skillet.md → Settings → Devices.'
  }
  const connect = msg.match(/connect failed:\s*(.*)/s)
  if (connect) {
    return (
      connect[1]!.replace(/Could not connect with pair code:\s*/i, '').trim() ||
      'Could not connect with that code.'
    )
  }
  return msg.replace(/^✗\s*/, '').replace(/kit bootstrap failed:\s*/i, '').trim() || 'Something went wrong.'
}

export function cleanCliError(raw: string): string {
  return humanizeAppError(raw)
}

export function prettyAccel(a: string): string {
  if (!a) return ''
  return a
    .split('+')
    .map((p) => {
      if (p === 'Alt' || p === 'Option') return '⌥'
      if (p === 'Control' || p === 'Ctrl') return '⌃'
      if (p === 'Shift') return '⇧'
      if (p === 'Super' || p === 'Command' || p === 'Meta' || p === 'Cmd') return '⌘'
      if (p === 'Space') return 'Space'
      if (p.startsWith('Key')) return p.slice(3)
      if (p.startsWith('Digit')) return p.slice(5)
      return p
    })
    .join('')
}

/**
 * Why a sync failed — drives which recovery surface the tray shows.
 * 'disconnected' = the registry rejected this machine's device token (the
 * device was removed on the web); 'auth-required' = the CLI's unpaired guard
 * (this machine never linked an account — route to the pair gate);
 * 'approval-block' = a quarantined/gated update, not a connectivity problem;
 * 'offline' = everything else.
 */
export type SyncFailureKind =
  | 'disconnected'
  | 'auth-required'
  | 'approval-block'
  | 'upgrade-required'
  | 'offline'

export function classifySyncFailure(input: {
  code?: string | null
  message?: string | null
}): SyncFailureKind {
  if (input.code === 'machine_disconnected') return 'disconnected'
  // The CLI refuses registry work until the machine is paired: `--json` mode
  // emits {ok:false, error:"auth_required", code:"auth_required"} on stdout
  // (cli/src/auth-required.ts); the desktop's JSON unwrap passes the error
  // string through as the message, so match both fields.
  if (input.code === 'auth_required' || input.message === 'auth_required')
    return 'auth-required'
  // The registry fails an unpaired/null-user device token closed with 403
  // device_not_paired. Core routes it to the auth-required lane too; classify
  // it here as defense-in-depth so a mid-deploy 403 never reads as offline.
  if (input.code === 'device_not_paired') return 'auth-required'
  // The registry's minimum-version gate (HTTP 426) — this client is too old to sync.
  if (input.code === 'client_upgrade_required') return 'upgrade-required'
  const msg = input.message ?? ''
  // Older bundled sidecars predate the structured code — their only signal is
  // the pinned prose from core's sync throw (see core/src/commands/sync.ts).
  if (/disconnected from your account/i.test(msg)) return 'disconnected'
  // Non-JSON paths (a rejected invoke carries the CLI's stderr prose).
  if (/is not paired to an account/i.test(msg)) return 'auth-required'
  if (/requires approval|quarantin|APPROVE_PRE|allow-quarantined|needs? review/i.test(msg))
    return 'approval-block'
  return 'offline'
}

/**
 * Decide what a tray-open `sync --check` envelope means. The CLI reports
 * `ok: false` whenever ANY per-skill outcome failed, with `changed` computed
 * independently — so partial failures must keep triggering the auto-sync;
 * disconnected and upgrade-required short-circuit it. The sticky blockers
 * (disconnected, upgrade-required) are BOTH set and cleared here: an unambiguous
 * success envelope (`ok !== false`) clears them, so a client that only ever runs
 * the tray-open check still recovers once the floor is lowered — without this it
 * could stay wedged on the block screen until a full sync, which the block screen
 * itself prevents.
 */
export type CheckSyncAction = {
  setDisconnected: boolean
  clearDisconnected: boolean
  setUpgradeRequired: boolean
  clearUpgradeRequired: boolean
  /**
   * A parsed check envelope proves the CLI ran and (unless the failure
   * classifies as `offline`) the registry answered — so a stale Offline latch
   * (`traySyncError`, otherwise cleared only by a successful FULL sync) must
   * clear here too, mirroring how this path both sets and clears the
   * disconnected/upgrade latches. The check never SETS the latch: only a full
   * sync failure does.
   */
  clearSyncError: boolean
  runSync: boolean
}

export function checkSyncAction(parsed: {
  ok?: boolean
  changed?: boolean
  error?: string
  code?: string
  unionPull?: unknown[]
  pull?: unknown[]
}): CheckSyncAction {
  if (parsed.ok === false) {
    const failure = classifySyncFailure({ code: parsed.code, message: parsed.error })
    const disconnected = failure === 'disconnected'
    const upgradeRequired = failure === 'upgrade-required'
    // Per-item results prove the registry ANSWERED — a check that fails on
    // per-skill outcomes (scan pending, one bad version) carries no error
    // string, so reachability rides on the arrays, mirroring
    // syncReachedRegistry for full syncs.
    const reached = !!(parsed.unionPull?.length || parsed.pull?.length)
    return {
      setDisconnected: disconnected,
      clearDisconnected: false,
      setUpgradeRequired: upgradeRequired,
      clearUpgradeRequired: false,
      // auth-required / approval-block / disconnected / upgrade-required all
      // prove the check ran and route to their own surfaces; painting
      // "Offline" alongside them would be wrong. Only a genuine connectivity
      // failure (unclassified error, no per-item data) keeps the latch.
      clearSyncError: reached || failure !== 'offline',
      // Never auto-sync into a known-blocking failure; a partial failure with
      // changed:true still does.
      runSync: !disconnected && !upgradeRequired && parsed.changed === true,
    }
  }
  return {
    setDisconnected: false,
    clearDisconnected: true,
    setUpgradeRequired: false,
    clearUpgradeRequired: true,
    clearSyncError: true,
    runSync: parsed.changed === true,
  }
}

/**
 * Whether a fresh pending read should clear a pinned `approval-block` latch.
 *
 * The latch is set when a non-TTY `sync` refuses an approval-gated (or
 * quarantined) skill — its error prose classifies as 'approval-block'. It only
 * otherwise clears on a fully clean sync, which can't happen while that skill
 * keeps tripping the gate. But `pending_updates` folds in account-scoped
 * decisions on every call, so a *confirmed* empty queue (count 0) proves the
 * gate was already cleared elsewhere (e.g. approved on the web) and the latch is
 * stale. A transient read failure (count null) proves nothing — keep the latch.
 * Without this, a web-side approval empties both queues yet leaves the tray's
 * "Skill update waiting" banner up with nothing left to review.
 */
export function shouldClearApprovalBlock(pendingCount: number | null): boolean {
  return pendingCount === 0
}

/**
 * The command palette's three states from environment signals. 'loading' is the
 * packaged-app cold start where the CLI IPC hasn't answered — critically NOT
 * 'picker', so a not-yet-ready app never shows pastable MOCK skills, and NOT
 * 'gate', so an actually-paired user isn't nagged. Browser preview maps straight
 * to gate/picker for the design surface.
 */
export type PalettePhase = 'loading' | 'gate' | 'picker'

export function palettePhaseFrom(input: {
  preview: boolean
  previewAuthOut: boolean
  cliReady: boolean
  unpaired: boolean
}): PalettePhase {
  if (input.preview) return input.previewAuthOut ? 'gate' : 'picker'
  if (!input.cliReady) return 'loading'
  return input.unpaired ? 'gate' : 'picker'
}

/** Hero status card state, derived from auth + sync signals. */
// ── sync resilience: reachable vs offline, and per-skill issue surfacing ──────

export type SyncIssue = { slug: string; reason: string }

/**
 * A sync/check envelope REACHED the registry when it carries any per-skill
 * response (`unionPull`) or materialized data (`kits`/`adapters`). Presence of
 * any of these proves the registry answered — so an `ok:false` alongside them is
 * a PARTIAL (per-skill) failure, never "can't reach Skillet". Only a bodyless
 * `ok:false` is genuinely offline. This is what stops one bad skill (a pending
 * scan, an unverifiable version) from painting the whole app "Offline".
 */
export function syncReachedRegistry(raw: {
  kits?: unknown[]
  adapters?: unknown[]
  unionPull?: unknown[]
}): boolean {
  return !!(raw.kits?.length || raw.adapters?.length || raw.unionPull?.length)
}

/** Turn a core failure reason (`scan_pending: …`, `corrupt_storage: …`) into
 *  one calm human line. Unknown reasons pass through, trimmed of the code prefix. */
export function humanizeSyncReason(reason: string | undefined | null): string {
  const r = reason ?? ''
  if (/^scan_pending/.test(r)) return "the author's security scan hasn't finished"
  if (/^corrupt_storage/.test(r)) return "this version can't be verified yet"
  if (/^quarantin/i.test(r)) return 'it was held by a security scan'
  if (/^materialize_failed/.test(r)) return "it couldn't be written to an agent"
  if (/^edit_unreadable/.test(r)) return 'a local copy could not be read'
  // Pin mismatch: the author rotated their signing key, so every skill of
  // theirs refuses at once. The raw reason is two 64-char hashes — useless in a
  // 360px tray — and the recovery is a single command, so say that instead.
  if (/key_id_mismatch|author_key_changed/.test(r)) {
    const handle = /handle (\S+) pinned to/.exec(r)?.[1]
    return handle
      ? `the signing key for @${handle} changed. Run skillet pin accept ${handle} to trust the new one`
      : "the author's signing key changed"
  }
  // Drop a leading `code: ` prefix so the raw fallback still reads cleanly.
  const stripped = r.replace(/^[a-z_]+:\s*/i, '').trim()
  return stripped || 'it could not be synced'
}

/** Per-skill failures the registry reported this sync, for surfacing (not
 *  swallowing). Reads `unionPull` failures; deduped by slug, newest reason wins. */
export function collectSyncIssues(raw: {
  unionPull?: Array<{ slug?: string; status?: string; reason?: string }>
}): SyncIssue[] {
  const byId = new Map<string, SyncIssue>()
  for (const u of raw.unionPull ?? []) {
    if (u.status === 'failed' && u.slug) {
      byId.set(u.slug, { slug: u.slug, reason: humanizeSyncReason(u.reason) })
    }
  }
  return [...byId.values()]
}

/**
 * Title + detail for the tray's sync-failure note.
 *
 * One sync can fail hundreds of skills at once (an author rotating their
 * signing key fails every skill of theirs in one go), and listing every slug
 * both buried the reason and grew the row past the panel. When the failures
 * share one reason, that reason IS the message; the slug list is the fallback
 * for a genuinely mixed batch.
 */
export function syncIssueNote(issues: SyncIssue[]): { title: string; detail: string } {
  const bare = (s: string): string => s.split('/').pop() ?? s
  const n = issues.length
  if (n === 1) return { title: `Couldn't sync ${bare(issues[0]!.slug)}`, detail: issues[0]!.reason }
  const owners = new Set(
    issues.map((i) => (i.slug.startsWith('@') ? i.slug.split('/')[0]! : '')).filter(Boolean),
  )
  const from = owners.size === 1 ? ` from ${[...owners][0]}` : ''
  const reasons = new Set(issues.map((i) => i.reason))
  return {
    title: `${n} skills${from} couldn't sync`,
    detail: reasons.size === 1 ? [...reasons][0]! : issues.map((i) => bare(i.slug)).join(', '),
  }
}

export type HeroCardState = 'synced' | 'syncing' | 'offline' | 'not-connected'

export function heroCardState(input: {
  linked: boolean
  syncing: boolean
  syncError: boolean
}): HeroCardState {
  if (!input.linked) return 'not-connected'
  if (input.syncing) return 'syncing'
  if (input.syncError) return 'offline'
  return 'synced'
}

// ── Parked agent folders (macOS folder access, U3) ──────────────────────────
// A sync envelope adapter with `parked: true` is a runtime whose skills folder
// resolves into a macOS-protected folder (Documents, Desktop, Downloads) that
// this app hasn't been granted yet — the sync ran but that folder was left
// untouched. `parkedDenied` means the grant was refused or revoked (the
// sidecar's read failed with a permission error), so another sync alone won't
// fix it. R7: while any adapter is parked the tray must carry a needs-access
// notice and never read as plainly synced.

export type ParkedAdapterLike = { parked?: boolean; parkedDenied?: boolean }

export type ParkedNotice = { count: number; denied: boolean }

export function parkedNotice(
  adapters: ParkedAdapterLike[] | null | undefined,
): ParkedNotice | null {
  const parked = (adapters ?? []).filter((a) => a.parked === true)
  if (parked.length === 0) return null
  return { count: parked.length, denied: parked.some((a) => a.parkedDenied === true) }
}

/** Notice copy: one row, an action, no modes. The denied variant routes to
 *  System Settings because re-syncing cannot re-prompt a refused grant. */
export function parkedNoticeCopy(notice: ParkedNotice): { title: string; detail: string } {
  const title =
    notice.count === 1
      ? '1 agent folder needs access'
      : `${notice.count} agent folders need access`
  const detail = notice.denied
    ? 'Allow Skillet in System Settings under Privacy and Security, then sync.'
    : notice.count === 1
      ? 'Sync now to grant it.'
      : 'Sync now to grant them.'
  return { title, detail }
}

/**
 * Hero status text override (R7): a resting synced hero with a parked folder
 * must not read as plain "Synced" — the status line says what's missing.
 * Syncing/offline/not-connected keep their own text (they already aren't
 * "Synced", and overwriting them would hide a more urgent state).
 */
export function heroStatusOverride(
  state: HeroCardState,
  notice: ParkedNotice | null,
): string | null {
  return state === 'synced' && notice ? 'Needs access' : null
}

// ── Customized skills (customize-in-place) ──────────────────────────────────
// When you (or your agent) edit a synced skill it becomes YOUR version: the edit
// stays live and the author's updates are held. Rows come from `skillet edits
// list --json` → { ok, customized: [...] }. The tray no longer decides the
// reconcile (U7/R14): it keeps only the quiet "Edited locally" label on the
// skill row and a "See changes" action that opens the desktop viewer window
// (?view=viewer). Update awareness routes through the normal updates badge to
// /updates. These are just selection helpers — no card decision logic.

/** One row from `skillet edits list --json`. */
export type CustomizedRow = {
  /** State key — the lineage ref the skill is customized from. */
  slug: string
  /** `@author/slug` lineage ref. */
  ref: string
  /** Always true — every row is a customized skill (R9 honesty). */
  customized: true
  /** A held author update is waiting AND hasn't been acknowledged. */
  hasUpdate: boolean
  /** The baseline version the edit was made against. */
  version?: number
  /** The held update itself, when one exists. */
  held?: { version?: number; hash?: string }
}

/** The bare slug segment used to match a customized ref to a materialized skill. */
export function bareCustomizedSlug(ref: string): string {
  return (ref.split('/').pop() ?? ref).replace(/^@/, '')
}

/** Set of bare slugs that are customized — for the quiet row label (R9). */
export function customizedSlugSet(rows: CustomizedRow[]): Set<string> {
  return new Set(rows.map((r) => bareCustomizedSlug(r.ref || r.slug)))
}

export function isSlugCustomized(slug: string, set: Set<string>): boolean {
  return set.has(bareCustomizedSlug(slug))
}

/**
 * Bare-slug set of edited skills for the row label: the PERSISTED customized
 * skills (`edits list`) UNION the UNRECONCILED live edits (`edits check`), so a
 * fresh store edit reads as "Edited locally" on tray-open before the next full
 * sync marks it customized. `liveEditSlugs` are `@owner/slug` state keys.
 */
export function editedSlugSet(rows: CustomizedRow[], liveEditSlugs: string[]): Set<string> {
  const set = customizedSlugSet(rows)
  for (const slug of liveEditSlugs) set.add(bareCustomizedSlug(slug))
  return set
}

/**
 * The edited-state signal (R9 honesty: you're running your own copy) — a quiet
 * "Edited locally" on the object's own subtitle line, not a capsule in the
 * trailing lane (which collides with the timestamp). "Edited locally" (not bare
 * "Edited") answers who + against-what: your copy on this device differs from
 * the synced version — which matters most on a skill you authored, where
 * "@you · Edited" could otherwise read as an upstream change. No hover tooltip:
 * native apps don't hover-to-explain state, and the full meaning (your version
 * stays live, updates held) lives in the viewer's "See changes" action, which
 * appears only when there's actually a decision to make.
 */
export const EDITED_LABEL = 'Edited locally'
export function editedLabelHtml(): string {
  return `<span class="lib-edited">${EDITED_LABEL}</span>`
}

export function eventToAccel(e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (/^(Shift|Alt|Control|Meta)(Left|Right)$/.test(e.code)) return null
  const mods: string[] = []
  if (e.metaKey) mods.push('Super')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (!mods.length) return null
  return [...mods, e.code].join('+')
}

/**
 * One-time "sync skill stats?" ask card gate. Shows only on a paired machine
 * where the account-level question is confirmed unanswered and this machine
 * hasn't asked before. Unknown consent state (old sidecar without `activity
 * choose`, parse failure, status fetch error) means NO card — silent degrade,
 * never a card that could double-ask or error on click.
 */
/** The ask waits for a habit, not a first run: below this many local routes the
 * synced chart would be near-empty and the pitch lands flat. */
export const STATS_ASK_MIN_RUNS = 5

export function shouldShowStatsAsk(input: {
  paired: boolean
  consentChosen: boolean | null
  locallyDismissed: boolean
  /** Local /skillet runs recorded on this machine. */
  localRuns: number
}): boolean {
  return (
    input.paired &&
    input.consentChosen === false &&
    !input.locallyDismissed &&
    input.localRuns >= STATS_ASK_MIN_RUNS
  )
}
