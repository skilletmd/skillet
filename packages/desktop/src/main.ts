import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { getVersion } from '@tauri-apps/api/app'
import { emit, listen } from '@tauri-apps/api/event'
import { check, type Update as TauriUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { AGENT_LOGOS } from './agent-logos'
import { createPressGuard } from './press-guard'
import { skillCover, kitCover, localCover, updateCover } from './covers'
import { installCoverPainting } from './cover-paint'
import { isUnpairedAuth, resolveTrayAuthPresentation } from './tray-auth-presentation'
import { resolveRailBadges } from './tray-rail-presentation'
import { parseCliJson } from './cli-json'
import { extractPairCode, pairCodeInputError } from './pair-code'
import { normalizeDeviceLabel } from './device-label'
import { escapeHtml } from './escape-html'
import { vocabularyEntry } from '@skillet/protocol/scan-vocabulary'
import {
  clearPersistedDeviceSyncSeq,
  startDeviceSyncStream,
  type DeviceSyncStreamConfig,
  type DeviceSyncStreamController,
} from './device-sync-stream'
import {
  deviceNoun,
  devicePlatform,
  findOnDeviceLabel,
  isMacOsDesktop,
  uploadEmptyHint,
} from './platform-copy'
import {
  capturableSkills,
  editedLabelHtml,
  isSlugCustomized,
  editedSlugSet,
  syncReachedRegistry,
  collectSyncIssues,
  syncIssueNote,
  type SyncIssue,
  checkSyncAction,
  classifySyncFailure,
  cleanCliError,
  eventToAccel,
  heroCardState,
  accessibilityActionLabel,
  heroStatusOverride,
  humanizeAppError,
  palettePhaseFrom,
  parkedNotice,
  parkedNoticeCopy,
  type ParkedNotice,
  prettyAccel,
  resolveTraySyncKits,
  shouldClearApprovalBlock,
  shouldFallbackSyncOnCheckError,
  shouldRunTrayOpenCheck,
  shouldShowStatsAsk,
  uploadOutcome,
  type CustomizedRow,
  type HeroCardState,
  type KitStatus,
  type PalettePhase,
  type Skill,
  type SyncKitGroupJson,
  type UploadFinding,
  type UploadResultJson,
} from './tray-logic'

// Size the tray window to its content. The main railed tabs (Latest/Skills/Agents)
// are pinned to a fixed panel height in CSS (`.panel.tray.tray-railed`), so their
// content measures a constant 480 and every tab is the same window size; long lists
// scroll inside. Short surfaces (sign-in, settings) still size to their content.
// MAX_TRAY_HEIGHT is a safety ceiling so nothing can grow the window to full screen.
const MAX_TRAY_HEIGHT = 560
function fitTrayWindow() {
  requestAnimationFrame(() => {
    const panel = document.querySelector('.panel') as HTMLElement | null
    if (!panel) return
    const h = Math.min(panel.offsetHeight, MAX_TRAY_HEIGHT)
    if (h > 0) getCurrentWindow().setSize(new LogicalSize(360, h)).catch(() => {})
  })
}

// One bundle, three windows (palette / tray / onboarding), selected by ?view=.
type SyncJson = {
  ok?: boolean
  error?: string
  code?: string
  adapters?: Adapter[]
  kits?: SyncKitGroupJson[]
  kitCount?: number
  skillCount?: number
  pruned?: Array<{ slug: string }>
  trashDir?: string | null
  // Customize-in-place: skills whose materialized copy was edited (yours now,
  // author updates held), and skills that unsubscribed into plain local skills.
  customized?: Array<{ slug: string; hasUpdate: boolean }>
  localized?: Array<{ slug: string }>
  // Per-skill registry responses. Its presence proves the registry was reached,
  // so an ok:false alongside it is a partial failure, not "offline".
  unionPull?: Array<{ slug: string; status: string; reason?: string }>
}
type AuthStatus = {
  ok?: boolean
  bearer: { kind: string; tokenPreview: string | null }
  identity: { handle: string | null } | null
  whoami: { handle: string | null; avatar_url?: string | null; user_id?: string | null } | null
  linked_machine?: boolean
  /** This machine's device label (the web Connections row name). Absent on older sidecars. */
  device_label?: string | null
}
type Adapter = {
  name: string
  status: string
  count?: number
  targetDir?: string
  label?: string
  /** The adapter's folder needs macOS access — sync parked it (U3). */
  parked?: boolean
  /** The macOS grant was refused or revoked; System Settings is the fix. */
  parkedDenied?: boolean
}
// Only the count of pending updates is ever surfaced in the tray (badge, CTA,
// pulse) — review happens on the web, so the per-field diff shape isn't consumed
// here. `id` is kept for stable array identity, not for display.
type Update = { id: string }

const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'palette'
const app = document.getElementById('app')!

// True when running the browser preview (no Tauri runtime) — gates preview-only affordances.
function previewInBrowser(): boolean {
  return !('__TAURI_INTERNALS__' in window)
}
// Preview-only: force a hero-card state via `?state=` so all four are viewable in the browser.
function previewCardStateOverride(): HeroCardState | null {
  if (!previewInBrowser()) return null
  const s = params.get('state')
  return s === 'synced' || s === 'syncing' || s === 'offline' || s === 'not-connected' ? s : null
}

// First time each skill was seen locally — approximates "when it synced in".
function readFirstSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('skillFirstSeen') ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function writeFirstSeen(map: Record<string, number>): void {
  try {
    localStorage.setItem('skillFirstSeen', JSON.stringify(map))
  } catch {
    /* private mode */
  }
}

/**
 * Forget slugs this device no longer has.
 *
 * The stamp is written once and used as "when this arrived", so without a prune
 * a skill you removed and re-added weeks later kept its ORIGINAL stamp: it sorted
 * to the bottom of Latest and displayed an age of days, which is the opposite of
 * what Latest promises. It also grew forever — one author subscription left ~400
 * dead entries behind after the skills were gone.
 *
 * `known` MUST be every slug on the device, never a per-view subset, or a view
 * that lists fewer skills would forget all the others.
 */
function pruneSkillFirstSeen(known: string[]): void {
  const keep = new Set(known)
  const map = readFirstSeen()
  let changed = false
  for (const slug of Object.keys(map))
    if (!keep.has(slug)) {
      delete map[slug]
      changed = true
    }
  if (changed) writeFirstSeen(map)
}

function skillFirstSeen(slugs: string[]): Record<string, number> {
  const map = readFirstSeen()
  let changed = false
  for (const s of slugs)
    if (!(s in map)) {
      map[s] = Date.now()
      changed = true
    }
  if (changed) writeFirstSeen(map)
  return map
}
// ── Data layer: real `skillet` CLI, or mock when the CLI isn't found ───────────────
// Mirrors the Swift app's SyncClient seam (CLISyncClient vs MockSyncClient) so the
// app is never empty and demos every state.
let cliReady: boolean | null = null
async function usingCli(): Promise<boolean> {
  // Re-check while still not TRUE: at cold start the Tauri IPC can answer `false`
  // (or the invoke rejects) before the backend is ready, and caching that first
  // `false` forever would strand the whole app on MOCK data. Once it's true it
  // sticks — the sidecar doesn't disappear mid-session.
  if (cliReady !== true) {
    const was = cliReady
    cliReady = await invoke<boolean>('cli_available').catch(() => false)
    if (was === false && cliReady) {
      // We booted on mock before the backend was ready; now the CLI is live.
      // Drop the mock caches so the current render refetches everything real
      // (getKitStatus runs before getAdapters, so clearing here refills both).
      trayKit = null
      trayAdapters = null
      trayDetectedAgents = null
      trayPending = null
      trayAuth = null
    }
  }
  return cliReady
}

const MOCK_SKILLS: Skill[] = [
  {
    slug: 'refund',
    path: '/Users/you/.claude/skills/refund/SKILL.md',
    category: 'finance',
    name: 'Refund policy',
    description: 'How we issue and decline refunds',
    owner: 'you',
    source: 'local',
    pinned: true,
    body: '# Refund policy\n\nApprove refunds under $50 automatically. Above $50, ask for the order ID and reason, then summarize for a human.',
  },
  {
    slug: 'deploy',
    path: '/Users/you/.claude/skills/deploy/SKILL.md',
    category: 'devops',
    name: 'Deploy ritual',
    description: 'Pre-flight + ship + verify',
    owner: 'you',
    source: 'local',
    pinned: false,
    body: '# Deploy ritual\n\n1. Green CI on main. 2. Tag the release. 3. Smoke test staging. 4. Promote. 5. Watch error rate 10 min.',
  },
  {
    slug: 'brand',
    category: 'writing',
    name: 'Brand voice',
    description: 'How we write, in our words',
    owner: 'team',
    source: 'registry',
    pinned: false,
    body: '# Brand voice\n\nWrite like an operator. No hedging, no AI-ese, no em dashes. Short sentences.',
  },
  {
    slug: 'pr-review',
    category: 'quality',
    name: 'PR review checklist',
    description: 'What to check before approving',
    owner: 'simonw',
    source: 'registry',
    pinned: false,
    body: '# PR review checklist\n\nTests cover the change. No N+1 queries. Error paths handled.',
  },
  {
    slug: 'sql',
    path: '/Users/you/.codex/skills/sql/SKILL.md',
    category: 'database',
    name: 'SQL style',
    description: 'House conventions for queries',
    owner: null,
    source: 'local',
    pinned: false,
    body: '# SQL style\n\nLowercase keywords. CTEs over nested subqueries. Always alias joins.',
  },
]
const MOCK_ADAPTERS: Adapter[] = [
  { name: 'Claude Code', status: 'materialized', targetDir: '~/.claude/skills' },
  { name: 'Cursor', status: 'materialized', targetDir: '~/.cursor/skills' },
  { name: 'ChatGPT', status: 'materialized', targetDir: '~/Library/Application Support/ChatGPT/skills' },
  { name: 'Codex', status: 'materialized', targetDir: '~/.codex/skills' },
  { name: 'Devin Desktop', status: 'skipped-not-detected' },
]
const MOCK_KIT: KitStatus = {
  skills: MOCK_SKILLS,
  groups: [
    { kitRef: '@you/work', synced: true, skills: ['refund', 'deploy'] },
    { kitRef: '@team/brand', synced: true, skills: ['brand'] },
    { kitRef: null, synced: false, skills: ['sql'] },
    { kitRef: '@simonw/reviews', synced: true, skills: ['pr-review'] },
  ],
}
// Preview-only: the web preview (no CLI sidecar) defaults to the signed-in tray so
// the main design surface renders. Force the signed-out state with `?auth=out`.
const MOCK_AUTH: AuthStatus = {
  ok: true,
  bearer: { kind: 'device', tokenPreview: 'sk_live_…9f2' },
  identity: { handle: 'tay' },
  whoami: { handle: 'tay', user_id: 'u_preview' },
  linked_machine: true,
  device_label: 'MacBook Pro',
}
const MOCK_UPDATES: Update[] = [{ id: 'u1' }]

async function getKitStatus(): Promise<KitStatus> {
  if (!(await usingCli())) {
    // Browser preview shows the design mock; inside the packaged app a cold-start
    // `cli_available:false` must NEVER surface MOCK_KIT — its fake skills are
    // pastable from the palette into the user's real document. Empty until the
    // CLI is ready (usingCli re-probes, then the caller refetches real data).
    return previewInBrowser() ? MOCK_KIT : { skills: [], groups: [] }
  }
  try {
    return JSON.parse(await invoke<string>('kit_status')) as KitStatus
  } catch {
    return { skills: [], groups: [] }
  }
}
async function getSkills(): Promise<Skill[]> {
  const kit = await getKitStatus()
  return kit.skills
}
// Dedupe concurrent syncs: a sync can take 10s+, and overlapping ones fight over
// the CLI's lock (the loser returns ok:false + lockPath, which read as "offline").
// Share one in-flight sync instead of stacking them.
//
// `background` (U3, fail-closed default true) threads the user-initiated vs
// automatic distinction down to the sidecar: only a user-initiated sync may
// read an agent folder that still needs the macOS folder-access grant (and
// prompt for it once). A user-initiated request that lands while a background
// sync is in flight joins that sync (runSync's queue re-runs it user-initiated).
let adaptersInFlight: Promise<Adapter[]> | null = null
function getAdapters(opts: { background?: boolean } = {}): Promise<Adapter[]> {
  if (adaptersInFlight) return adaptersInFlight
  adaptersInFlight = getAdaptersUncached(opts.background !== false).finally(() => {
    adaptersInFlight = null
  })
  return adaptersInFlight
}
// Which agents are on THIS machine + where their skills live — a pure local scan
// (`skillet runtimes --json`), independent of the registry sync. Drives the Agents
// facepile + folder popover, so a failing sync (deleted skill, DB reset, offline)
// never blanks out your detected agents. Returns detected adapters only.
async function getDetectedAgents(): Promise<Adapter[]> {
  if (!(await usingCli())) {
    return MOCK_ADAPTERS.filter((a) => a.status !== 'skipped-not-detected')
  }
  try {
    const parsed = JSON.parse(await invoke<string>('detect_runtimes')) as {
      runtimes?: { name: string; label?: string; targetDir?: string }[]
    }
    return (parsed.runtimes ?? []).map((s) => ({
      name: s.name,
      status: 'materialized',
      targetDir: s.targetDir,
      label: s.label,
    }))
  } catch {
    return []
  }
}
async function getAdaptersUncached(background: boolean): Promise<Adapter[]> {
  if (!(await usingCli())) return MOCK_ADAPTERS
  // A quarantined/approval-gated update fails the sync but is NOT a connectivity
  // problem — the CLI prints progress text then a `{"ok":false,"error":"…approval…"}`
  // blob, so plain JSON.parse of the whole stdout throws. Classify it as review, not offline.
  let rawStr: string
  try {
    rawStr = await invoke<string>('sync_skills', { background })
  } catch (e) {
    traySyncKits = null
    applySyncFailure({ message: String(e) })
    return []
  }
  try {
    const raw = JSON.parse(rawStr) as SyncJson & {
      ok?: boolean
      error?: string
      lockPath?: string
    }
    // A held lock (lockPath) with NO data means another sync is already in flight
    // and this one couldn't get in — that's not offline. Keep the last-known
    // adapters + state; the in-flight sync refreshes us when it lands. (If the
    // sync DID return adapters/kits, fall through and use them below.)
    if (raw.ok === false && raw.lockPath && !raw.kits?.length && !raw.adapters?.length) {
      return trayAdapters ?? []
    }
    // ok:false but the registry ANSWERED (unionPull / kit / adapter data present)
    // means some skills failed — a per-skill problem, not "can't reach Skillet".
    // Render the results and surface the reasons; only a truly bodyless ok:false
    // (no per-skill response at all) falls through to the offline screen.
    if (raw.ok === false && !syncReachedRegistry(raw)) {
      throw new Error(raw.error ?? 'sync failed')
    }
    // Surface per-skill failures instead of swallowing them (never blank to
    // "Offline" when the registry replied). Cleared to [] on a fully clean sync.
    traySyncIssues = collectSyncIssues(raw)
    // Refresh the customized list (its source of truth is `edits list`) after
    // every sync — off the critical path, and a failure just keeps last state.
    void getCustomized().then((rows) => {
      if (rows === null) return // transient read failure — keep the last-known list
      const changed = JSON.stringify(rows) !== JSON.stringify(trayCustomized ?? [])
      trayCustomized = rows
      // A freshly-held update's card should appear without reopening the tray.
      if (changed && view === 'tray') paintTray(lastSkills, lastGranted)
    })
    traySyncKits = raw.kits?.length ? raw.kits : null
    traySyncError = false
    trayApprovalBlocked = false
    trayUpgradeRequired = false
    // The registry answered on this device's token — any sticky disconnect is stale.
    setTrayDisconnected(false)
    return raw.adapters ?? []
  } catch {
    // stdout wasn't clean JSON (progress text + trailing blob) or reported ok:false.
    // Prefer the trailing JSON's error field, fall back to scanning the whole string.
    let signal = rawStr
    let code: string | undefined
    const brace = rawStr.lastIndexOf('{')
    if (brace >= 0) {
      try {
        const j = JSON.parse(rawStr.slice(brace)) as { error?: string; code?: string }
        if (j.error) signal = j.error
        if (typeof j.code === 'string') code = j.code
      } catch {
        /* keep the raw string */
      }
    }
    traySyncKits = null
    applySyncFailure({ code, message: signal })
    return []
  }
}
// Customized skills — `skillet edits list --json` via the sidecar. Never throws:
// null means the list couldn't be read, so callers keep their last-known state
// instead of blanking it on a transient failure.
async function getCustomized(): Promise<CustomizedRow[] | null> {
  if (!(await usingCli())) return []
  try {
    const parsed = JSON.parse(await invoke<string>('list_edits')) as {
      customized?: CustomizedRow[]
    }
    return parsed.customized ?? []
  } catch {
    return null
  }
}

// Read-only live-edit scan — `skillet edits check --json` via the sidecar.
// Returns the `@owner/slug` keys of edits a full sync hasn't reconciled yet, so
// the tray can label them "Edited locally" on open. Never throws: [] on any
// failure (an unavailable scan just shows nothing new, never an error).
async function getLiveEdits(): Promise<string[]> {
  if (!(await usingCli())) return []
  try {
    const parsed = JSON.parse(await invoke<string>('edits_check')) as {
      edited?: Array<{ slug: string }>
    }
    return (parsed.edited ?? []).map((e) => e.slug)
  } catch {
    return []
  }
}

// null = transient read failure (keep the last-known list); [] = confirmed
// empty. The distinction matters for the approval-block latch: only a confirmed
// empty result is authoritative enough to clear it (see applyPending).
async function getPending(): Promise<Update[] | null> {
  if (!(await usingCli())) return MOCK_UPDATES.map((u) => ({ ...u }))
  try {
    const parsed = JSON.parse(await invoke<string>('pending_updates')) as {
      pending: { slug: string }[]
    }
    return (parsed.pending ?? []).map((p) => ({ id: p.slug }))
  } catch {
    return null
  }
}

/**
 * Reconcile the pending queue from a fresh CLI read. A null result is a
 * transient failure — keep the last-known list rather than blanking it. A
 * confirmed-empty result clears a stale `approval-block` latch; see
 * shouldClearApprovalBlock for why an empty queue is authoritative.
 */
/** Home-relative shortening for display (`/Users/tay/.claude` → `~/.claude`). */
function homeShort(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}
function applyPending(next: Update[] | null): void {
  if (next !== null) trayPending = next
  if (shouldClearApprovalBlock(next === null ? null : next.length)) {
    trayApprovalBlocked = false
  }
}

// Display labels only; the machine-readable runtime id stays `windsurf`
// (a wire contract with the CLI's `runtimes --json`). Windsurf rebranded to
// Devin Desktop 2026-06-02.
const RUNTIME_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  windsurf: 'Devin Desktop',
  devin: 'Devin',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
}
const pretty = (n: string): string => RUNTIME_NAMES[n] ?? n

// GitHub-style segmented pair-code input: 8 one-char cells; typing advances,
// backspace walks back, and pasting anywhere fills the whole row.
const PAIR_CODE_LEN = 8
function pairCodeBoxesHtml(id: string): string {
  const cells = Array.from(
    { length: PAIR_CODE_LEN },
    (_, i) =>
      (i === PAIR_CODE_LEN / 2 ? '<span class="code-dash"></span>' : '') +
      '<input class="code-cell" maxlength="1" autocapitalize="characters" autocorrect="off" spellcheck="false" />',
  ).join('')
  return `<div class="code-boxes" id="${id}">${cells}</div>`
}

/** Wire up a pairCodeBoxesHtml block. Returns a getter for the joined value.
 * `onChange` fires after every value change so callers can drive button state. */
function wirePairCodeBoxes(
  id: string,
  onSubmit: () => void,
  initial = '',
  onChange?: () => void,
): () => string {
  const root = document.getElementById(id)
  const cells = root ? [...root.querySelectorAll<HTMLInputElement>('.code-cell')] : []
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // A landing character pops its cell (scale spring); bulk fills cascade left
  // to right, so a paste visibly pours into the row instead of teleporting.
  const pop = (cell: HTMLInputElement, delayMs: number) => {
    cell.style.animationDelay = `${delayMs}ms`
    cell.classList.remove('pop')
    void cell.offsetWidth // restart the animation when the class re-lands
    cell.classList.add('pop')
  }
  const syncCellState = (cell: HTMLInputElement) => {
    cell.classList.toggle('filled', cell.value.length > 0)
  }
  const fill = (text: string, focus = true): boolean => {
    const code = extractPairCode(text) ?? clean(text).slice(0, PAIR_CODE_LEN)
    let staggered = 0
    cells.forEach((c, i) => {
      const next = code[i] ?? ''
      const changed = next !== c.value
      c.value = next
      syncCellState(c)
      if (next && changed && focus) pop(c, staggered++ * 26)
    })
    if (focus) cells[Math.min(code.length, PAIR_CODE_LEN - 1)]?.focus()
    onChange?.()
    return code.length === PAIR_CODE_LEN
  }
  // A paste/autofill that completes the code submits it — the user already
  // expressed the whole intent; a second Connect click is just friction.
  // Typed entry stays manual (mistyping the last cell shouldn't fire a claim).
  const bulkFill = (text: string) => {
    if (fill(text)) onSubmit()
  }
  cells.forEach((cell, i) => {
    cell.addEventListener('input', () => {
      const v = clean(cell.value)
      if (v.length > 1) {
        // Multi-char input (autofill, mid-row paste): treat as a bulk fill.
        bulkFill(cells.slice(0, i).map((c) => c.value).join('') + v)
        return
      }
      cell.value = v
      syncCellState(cell)
      if (v) pop(cell, 0)
      if (v && i < PAIR_CODE_LEN - 1) cells[i + 1]?.focus()
      onChange?.()
    })
    cell.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'Backspace' && !cell.value && i > 0) {
        const prev = cells[i - 1]!
        prev.value = ''
        syncCellState(prev)
        prev.focus()
        ke.preventDefault()
        onChange?.()
      } else if (ke.key === 'ArrowLeft' && i > 0) cells[i - 1]?.focus()
      else if (ke.key === 'ArrowRight' && i < PAIR_CODE_LEN - 1) cells[i + 1]?.focus()
      else if (ke.key === 'Enter') onSubmit()
    })
    cell.addEventListener('paste', (e) => {
      e.preventDefault()
      bulkFill((e as ClipboardEvent).clipboardData?.getData('text') ?? '')
    })
  })
  if (initial) fill(initial, false)
  cells[0]?.focus()
  return () => cells.map((c) => c.value).join('')
}
// Fail closed: if we can't determine the permission, show Grant rather than
// silently hide it (better to prompt than to assume trust we don't have).
const axGranted = () => invoke<boolean>('accessibility_granted').catch(() => false)
// Has the one-per-app macOS Accessibility prompt already been spent? Surfaces
// use this to label the action honestly: the first press can still raise the
// prompt, a later one can only send you to System Settings.
const axAsked = () => invoke<boolean>('accessibility_asked').catch(() => false)

function stripFrontmatter(body: string): string {
  if (!body.startsWith('---')) return body
  const lines = body.split('\n')
  const close = lines.indexOf('---', 1)
  return close === -1
    ? body
    : lines
        .slice(close + 1)
        .join('\n')
        .trim()
}
function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 10) return 'Synced just now'
  if (s < 60) return `Synced ${s}s ago`
  if (s < 3600) return `Synced ${Math.floor(s / 60)}m ago`
  return `Synced ${Math.floor(s / 3600)}h ago`
}

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`

// ── Palette (global shortcut → paste picker) ─────────────────────────────────
async function renderPalette() {
  const skills = await getSkills()
  let query = ''
  let sel = 0
  const placeholder = pastePickerPlaceholder()

  app.innerHTML = `
    <div class="panel">
      <div class="search">${SEARCH_ICON}<input id="q" placeholder="${escapeHtml(placeholder)}" autofocus autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" /></div>
      <div class="results" id="results"></div>
      <div class="footer"><span class="kbd">↵</span> paste <span class="kbd">esc</span> cancel <span class="spacer"></span><span id="count"></span></div>
    </div>`

  const input = document.getElementById('q') as HTMLInputElement
  const results = document.getElementById('results')!
  const count = document.getElementById('count')!
  const filtered = () => {
    if (!query) return skills
    const q = query.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.owner ?? '').toLowerCase().includes(q),
    )
  }
  function draw() {
    const list = filtered()
    if (sel >= list.length) sel = Math.max(0, list.length - 1)
    count.textContent = `${list.length} in your kit`
    if (list.length === 0) {
      results.innerHTML = `<div class="empty">No skills match “${escapeHtml(query)}”</div>`
      return
    }
    results.innerHTML = list
      .map((s, i) => {
        const author = s.owner ? `@${escapeHtml(s.owner)}` : '@you'
        return `<div class="row ${s.pinned ? 'pinned' : ''} ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="glyph">${s.pinned ? '★' : '▤'}</span><span class="meta"><div class="name">${escapeHtml(s.name)}</div><div class="summary">${escapeHtml(s.description)}</div></span><span class="author">${author}</span></div>`
      })
      .join('')
    results.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' })
  }
  const insert = (skill: Skill) => {
    if (!skill) return
    invoke('insert_skill', { body: skill.body ? stripFrontmatter(skill.body) : '' })
  }
  // Event delegation on the stable container — survives the innerHTML re-renders
  // in draw(), so a click can't be swallowed by a hover-triggered re-render.
  // Hover only toggles the highlight class (no re-render), keeping rows stable.
  results.addEventListener('mousemove', (e) => {
    const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null
    if (!row) return
    const i = Number(row.dataset.i)
    if (i === sel) return
    sel = i
    results.querySelector('.row.sel')?.classList.remove('sel')
    row.classList.add('sel')
  })
  results.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null
    if (row) insert(filtered()[Number(row.dataset.i)])
  })
  input.addEventListener('input', () => {
    query = input.value
    sel = 0
    draw()
  })
  input.addEventListener('keydown', (e) => {
    const list = filtered()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      sel = (sel + 1) % list.length
      draw()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      sel = (sel - 1 + list.length) % list.length
      draw()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (list[sel]) insert(list[sel])
    } else if (e.key === 'Escape') getCurrentWindow().hide()
  })
  // Window-level blur/focus/Escape live on ONE module-level handler set
  // (initPaletteWindowListeners) — never per-render, which stacked a fresh
  // handler on every show/hide cycle. The focus handler re-renders the window.
  draw()
  input.focus()
}

// Palette entry: skills only exist once the machine is paired, so an unpaired
// palette shows a pair gate instead of an empty picker. This is a palette-SIZED
// view — never paintAuthGate, which is tray-shaped (fitTrayWindow forces 360
// wide, `.panel.tray` CSS, a Quit-only footer) and would trap the user in a
// wrong-shaped overlay with no dismiss.
//
// 'loading' is the cold-start state inside the packaged app: the CLI IPC hasn't
// answered yet, so we can't know pairing — and must NOT fall through to the
// picker (which would show pastable MOCK data) or the gate (which would nag an
// actually-paired user). Re-evaluated on every window focus, so it swaps in both
// directions: cold-start→ready, pair-in-tray→picker, and sign-out→gate.
async function palettePhase(): Promise<PalettePhase> {
  if (previewInBrowser()) {
    return palettePhaseFrom({
      preview: true,
      previewAuthOut: params.get('auth') === 'out',
      cliReady: false,
      unpaired: false,
    })
  }
  const cliReady = await usingCli()
  const unpaired = cliReady ? isUnpairedAuth(await getAuth()) : false
  return palettePhaseFrom({ preview: false, previewAuthOut: false, cliReady, unpaired })
}

async function renderPaletteWindow(): Promise<void> {
  const phase = await palettePhase()
  if (phase === 'loading') renderPaletteLoading()
  else if (phase === 'gate') renderPaletteGate()
  else await renderPalette()
}

// Cold-start holding state — the CLI wasn't ready. Re-probe shortly (usingCli
// flips to true once the backend answers) and only while the window is focused,
// so a hidden palette doesn't poll. The re-render swaps to gate/picker.
function renderPaletteLoading(): void {
  app.innerHTML = `
    <div class="panel">
      <div class="palette-gate">
        ${brandMark('palette-gate-mark')}
        <span class="palette-gate-sub">Starting Skillet…</span>
      </div>
      <div class="footer"><span class="kbd">esc</span> close<span class="spacer"></span></div>
    </div>`
  window.setTimeout(() => {
    if (document.hasFocus()) void renderPaletteWindow()
  }, 300)
}

// One handler set for the palette window, registered once. Focus re-renders
// (re-evaluating phase and refetching skills); blur and Escape hide.
function initPaletteWindowListeners(): void {
  window.addEventListener('blur', () => void getCurrentWindow().hide())
  window.addEventListener('focus', () => void renderPaletteWindow())
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void getCurrentWindow().hide()
  })
}

// Same dismiss contract as the picker (Escape hides, blur hides) and the same
// fixed 560x392 frame. Pairing here — or in the tray while this window is
// hidden — swaps straight to the skill list without a restart.
function renderPaletteGate(): void {
  app.innerHTML = `
    <div class="panel">
      <div class="palette-gate">
        ${brandMark('palette-gate-mark')}
        <b class="palette-gate-title">Pair this device to drop skills</b>
        <span class="palette-gate-sub">Get your code at <button class="gate-link" id="pg-web">skillet.md/settings ↗</button> and paste it here. No account yet? That link creates one.</span>
        ${pairCodeBoxesHtml('pg-code-boxes')}
        <div class="appr-msg" id="pg-msg"></div>
        <button class="act fill palette-gate-connect" id="pg-go">Connect</button>
      </div>
      <div class="footer"><span class="kbd">esc</span> close<span class="spacer"></span></div>
    </div>`

  const msg = document.getElementById('pg-msg')!
  document.getElementById('pg-web')!.onclick = () =>
    void invoke('open_web', { path: '/settings' })

  // Window-level dismiss/focus handling lives on the module-level listener set
  // (initPaletteWindowListeners); its focus re-render re-evaluates pairing, so a
  // pair completed in the tray or CLI swaps this gate to the picker on next focus.

  const submit = async () => {
    const raw = getCode()
    const code = extractPairCode(raw)
    if (!code) {
      msg.textContent = pairCodeInputError(raw)
      return
    }
    msg.textContent = 'Connecting…'
    try {
      const res = parseCliJson<{ ok: boolean; error?: string }>(
        await invoke<string>('connect', { pairCode: code }),
        'connect',
      )
      if (res.ok) void renderPaletteWindow() // paired — swaps to the skill list in place
      else msg.textContent = res.error ?? 'Could not connect with that code.'
    } catch (e) {
      msg.textContent = cleanCliError(String(e))
    }
  }
  document.getElementById('pg-go')!.onclick = () => void submit()
  const getCode = wirePairCodeBoxes('pg-code-boxes', () => void submit())
}

// ── Tray dropdown ──────────────────────────────────────────────────────────────
let trayAdapters: Adapter[] | null = null
// Locally-detected agents (registry-independent) for the Agents facepile/folders.
let trayDetectedAgents: Adapter[] | null = null
// App version for Settings. Seeded at build time (shows in the browser mock too),
// then confirmed by getVersion() inside the Tauri runtime.
declare const __APP_VERSION__: string
let appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
let trayPending: Update[] | null = null
let traySyncedAt = Date.now()
let traySyncing = false
let syncPending = false
// A user-initiated sync request queued behind an in-flight one: the follow-up
// must re-run user-initiated or the click could never grant folder access (U3).
let syncPendingUserInitiated = false
// Per-skill sync failures the registry reported (e.g. a version that can't be
// verified). Surfaced as a dismissible note so a bad skill is actionable, not a
// misleading "Offline". Refreshed every sync; a clean sync clears it.
let traySyncIssues: SyncIssue[] = []
// Customized skills (your live edits; author updates held). null = not yet
// fetched; refreshed after every sync. Drives the quiet "Edited locally" row
// label and its "See changes" action (which opens the viewer window).
let trayCustomized: CustomizedRow[] | null = null
// Unreconciled live edits (`edits check`) — store/adapter drift a full sync
// hasn't turned into `customized_from` yet. Read-only; refreshed on tray-open so
// a fresh edit reads as "Edited locally" without waiting for a full sync.
let trayLiveEdits: string[] = []
let trayAuth: AuthStatus | null | undefined = undefined // undefined = not yet checked
let trayKit: KitStatus | null = null
let traySyncKits: SyncKitGroupJson[] | null = null
let deviceSyncStream: DeviceSyncStreamController | null = null
let deviceSyncStreamStarting = false
type TrayView = 'home' | 'signin' | 'settings' | 'kit' | 'backup' | 'agents' | 'folders'
let trayView: TrayView = 'home'
// Silent auto-update: an update that's been downloaded in the background and is
// waiting to be applied on a user-initiated relaunch. Never forced mid-session.
let pendingUpdate: TauriUpdate | null = null
// Consecutive failed update checks, and the version we know we can't reach.
// One failure is noise; a streak means this install can't update itself.
let updateFailStreak = 0
let updateStuckVersion: string | null = null
const UPDATE_FAIL_STREAK_BEFORE_NUDGE = 2
let updateReadyVersion: string | null = null
// Preview-only: deep-link a sub-view with `?nav=skills|settings`.
if (previewInBrowser()) {
  const nav = params.get('nav')
  if (nav === 'skills') trayView = 'kit'
  else if (nav === 'settings') trayView = 'settings'
  else if (nav === 'upload') trayView = 'backup'
}
// Last sync failed to reach Skillet — drives the hero card's `offline` state.
let traySyncError = false
// Sync was blocked by a quarantined/approval-gated update (not a connectivity error).
let trayApprovalBlocked = false
// Registry rejected this machine's device token — the device was removed on the
// web. Sticky: survives relaunch (localStorage) and later network errors. A
// cache of the server's last answer, not a source of truth: set only by an
// authoritative 401 classification, cleared by any successful authenticated
// sync/check, in-app connect, or local sign-out. localStorage loss is tolerated
// — the state re-derives from the next sync 401 within one tray-open cycle.
let trayDisconnected = false
try {
  trayDisconnected = localStorage.getItem('trayDisconnected') === '1'
} catch {
  /* ignore */
}
/** Returns true when the value changed, so callers can skip no-op repaints. */
function setTrayDisconnected(on: boolean): boolean {
  if (trayDisconnected === on) return false
  trayDisconnected = on
  try {
    if (on) localStorage.setItem('trayDisconnected', '1')
    else localStorage.removeItem('trayDisconnected')
  } catch {
    /* ignore */
  }
  return true
}
function trayAuthNow(): ReturnType<typeof resolveTrayAuthPresentation> {
  return resolveTrayAuthPresentation(trayAuth ?? null, { disconnected: trayDisconnected })
}
// True when the last sync classification was the registry's min-version rejection
// (HTTP 426). Re-evaluated on every sync/check — a transient offline tick clears
// it — and reset on a successful sync. The app can't sync until it updates.
// In-memory only (unlike trayDisconnected): the tray-open check re-derives it
// within one cycle, so persistence would only risk a stale wedge.
let trayUpgradeRequired = false
/** Returns true when the value changed, so callers can skip no-op repaints. */
function setTrayUpgradeRequired(on: boolean): boolean {
  if (trayUpgradeRequired === on) return false
  trayUpgradeRequired = on
  return true
}
/** Route a failed sync/check into exactly one of the failure surfaces. */
function applySyncFailure(signal: { code?: string | null; message?: string | null }): void {
  const kind = classifySyncFailure(signal)
  trayApprovalBlocked = kind === 'approval-block'
  traySyncError = kind === 'offline'
  trayUpgradeRequired = kind === 'upgrade-required'
  if (kind === 'disconnected') {
    setTrayDisconnected(true)
  }
  if (kind === 'auth-required') {
    // Unpaired machine (the CLI's pairing guard): route to the pair gate.
    // Not offline, not an approval block — and not the sticky disconnected
    // flag either: that flag means "was paired, revoked on the web" and
    // carries reconnect copy that would lie to a never-paired machine.
    trayView = 'signin'
  }
}
// Which kits are expanded in the Skills feed (a kit is a cluster of skills).
let expandedKits = new Set<string>()
// Last scroll offset of each view's list, so reopening the tray (which fully
// re-renders) lands where you left off instead of jumping back to the top.
const trayScrollByView = new Map<string, number>()
// Skills tab: group by kit ('kits', default) or a flat list of every skill ('skills').
let libView: 'kits' | 'skills' =
  previewInBrowser() && params.get('libview') === 'skills' ? 'skills' : 'kits'
let kitAnimateRef: string | null = null
// Play the panel entrance on the next paint (set when the tray opens).
// Briefly show a ✓ in place of the refresh glyph after a manual sync.
let syncJustSucceeded = false
let syncOkRevertTimer: number | null = null
// Pulse the bell badge once when a new notification arrives.
let lastPendingCount = 0
let badgePulse = false
// One-shot drill-in transition: 'push' (into a screen) / 'pop' (back). Consumed by
// panelWithRail on the next paint, so only the navigation animates, not re-renders.
let viewAnimDir: 'push' | 'pop' | '' = ''
// Last painted skills/granted, so the persistent bottom bar can re-render any
// view without re-fetching (navigation stays instant from the bottom).
let lastSkills: Skill[] = []
let lastGranted = false
let trayShortcut = ''
let recording = false
// One-time skill-stats ask card. 'unknown' until the sidecar confirms the
// account-level question is unanswered; any failure resolves to 'hide'
// (silent degrade — never an error card). localStorage 'statsAsked' remembers
// that THIS machine already showed it.
let statsAskState: 'unknown' | 'show' | 'hide' = 'unknown'

async function refreshStatsAsk(): Promise<void> {
  if (localStorage.getItem('statsAsked') === '1') {
    statsAskState = 'hide'
    return
  }
  try {
    const raw = await invoke<string>('skill_stats_status')
    const parsed = JSON.parse(raw) as { ok?: boolean; routeConsentChosen?: boolean }
    const consentChosen = parsed.ok === true ? parsed.routeConsentChosen === true : null
    // The ask waits for its subject: only fetch the local tally when the
    // question is otherwise live, and require real runs before showing.
    let localRuns = 0
    if (consentChosen === false) {
      try {
        const usage = JSON.parse(await invoke<string>('usage_stats')) as {
          skills?: { count?: number }[]
        }
        localRuns = (usage.skills ?? []).reduce((n, v) => n + (v.count ?? 0), 0)
      } catch {
        localRuns = 0
      }
    }
    const show = shouldShowStatsAsk({
      paired: trayAuthNow().showAccountKitGroups,
      consentChosen,
      locallyDismissed: false,
      localRuns,
    })
    const wasUnknown = statsAskState === 'unknown'
    statsAskState = show ? 'show' : 'hide'
    // Repaint only on the transition into 'show' so the card appears without
    // user action; 'hide' changes nothing visible.
    if (show && wasUnknown && trayView === 'home') paintTray(lastSkills, lastGranted)
  } catch {
    statsAskState = 'hide'
  }
}

let backupMsg = ''
let backupBusy = false
let importBusy = false
// Upload view: which local skills are selected (null = all). Desktop uploads
// are always private — publishing publicly happens on the web, never from here.
let uploadSelected: Set<string> | null = null
// Scan findings surfaced by the last upload attempt. `warn` = uploads that
// COMPLETED but the registry flagged (non-blocking); `error` = uploads the
// registry REFUSED (scan_blocked — a real credential). Both are visibility-
// independent: the registry blocks a real secret on Private and Public alike.
// Each line carries its `slug` so a multi-skill batch can attribute the row.
// null when the last attempt surfaced nothing.
// Post-upload result takeover (R9): when the scan BLOCKED part of an upload,
// the result replaces the checklist pane entirely — counts, per-skill evidence,
// and the fix get the full height instead of a footer strip fighting the
// upload button for space. null = checklist as normal.
//
// Warn-tier findings deliberately do NOT surface here: a private backup of
// your own already-running skill decides nothing, so a warning is noise. The
// findings are recorded server-side and the web is the deciding surface — the
// skill page trust panel shows them, and the studio's flip-to-public flow
// gates on them. Blocked stays: it changed the outcome of this upload.
let backupResult: {
  published: string[]
  blocked: { slug: string; findings: UploadFinding[] }[]
} | null = null

async function getAuth(): Promise<AuthStatus | null> {
  if (!(await usingCli())) return params.get('auth') === 'out' ? null : MOCK_AUTH
  try {
    return parseCliJson<AuthStatus>(await invoke<string>('auth_status'), 'auth status')
  } catch {
    return null
  }
}

function kitSkillDisplayName(slug: string, skills: Skill[]): string {
  const s = skills.find((x) => x.slug === slug)
  return s?.name ?? slug.split('/').pop() ?? slug
}

// A kit ref (`@owner/slug-name`) split into a friendly display name (de-slugged,
// title-cased) + owner handle — for the two-line row label.
function kitDisplayParts(kitRef: string): { name: string; owner: string } {
  const m = kitRef.match(/^@([^/]+)\/(.+)$/)
  const owner = m ? m[1] : ''
  const slug = m ? m[2] : kitRef.replace(/^@/, '')
  const name = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return { name, owner }
}

function resolveTraySyncKitsForTray(kit: KitStatus | null): SyncKitGroupJson[] {
  return resolveTraySyncKits(kit, traySyncKits)
}

// The unified skill/kit list.
//  - `sort`: 'recency' (Activity, newest first) vs 'kit' (Skills, kit order).
//  - `includeLocal`: fold local-only skills into an "On this Mac" group. Activity
//     shows ONLY what synced from the account, so it passes false.
//  - `view`: 'kits' (grouped, default) vs 'skills' (flat list of every skill).
function renderLibraryHtml(
  skills: Skill[],
  opts: {
    sort: 'recency' | 'kit'
    includeLocal: boolean
    view: 'kits' | 'skills'
    limit?: number
    // Skills tab: the row click opens the local markdown viewer, with a quiet
    // hover ↗ to the web page. Off (Latest) keeps the "tap → kit view" chip.
    localViewer?: boolean
  },
): string {
  const kits = resolveTraySyncKitsForTray(trayKit ?? null)
  const inKit = new Set<string>()
  for (const g of kits) for (const sk of g.skills) inKit.add(sk.slug)
  // Prune against the FULL device set (local skills + every kit member), not the
  // per-view subset each branch below builds — see pruneSkillFirstSeen.
  pruneSkillFirstSeen([...skills.map((sk) => sk.slug), ...inKit])
  // Everything synced lives in a kit, so anything loose is local to this device.
  let loose = skills.filter((s) => !inKit.has(s.slug))
  if (opts.sort === 'recency') {
    const seen = skillFirstSeen(skills.map((s) => s.slug))
    loose = loose.slice().sort((a, b) => (seen[b.slug] ?? 0) - (seen[a.slug] ?? 0))
  } else {
    loose = loose.slice().sort((a, b) => a.name.localeCompare(b.name))
  }

  const catOf = (slug: string): string | null => skills.find((s) => s.slug === slug)?.category ?? null
  // Second-line label: a loose skill isn't synced to the profile; synced skills
  // show their @author.
  const subOf = (slug: string): string => {
    const s = skills.find((x) => x.slug === slug)
    if (!s) return ''
    if (!inKit.has(slug)) return 'Not synced'
    return s.owner ? `@${s.owner}` : ''
  }

  // Two-line label: primary name on top, muted @owner (or source) underneath.
  // A customized skill appends "· Edited locally" (a titled span; static safe
  // HTML) after the escaped @owner, so the hover tooltip can carry its meaning.
  const nameCol = (name: string, sub: string, strong = false, edited = false): string =>
    `<span class="lib-name-col">
      <span class="lib-name${strong ? ' lib-kit-name' : ''}">${escapeHtml(name)}</span>${
        sub || edited
          ? edited
            ? // Split subtitle: the @author truncates first so the "Edited locally"
              // label always shows in full, even in space-tight rows (Latest, where
              // a timestamp shares the row).
              `<span class="lib-sub lib-sub-split"><span class="lib-sub-author">${escapeHtml(sub)}</span><span class="lib-edited-wrap">${sub ? ' · ' : ''}${editedLabelHtml()}</span></span>`
            : `<span class="lib-sub">${escapeHtml(sub)}</span>`
          : ''
      }
    </span>`

  // Skills you (or your agent) edited in place read as "@author · Edited locally"
  // on the subtitle line (R9 honesty: you're running your own copy, not theirs).
  // Persisted customized skills UNION unreconciled live edits, so a fresh edit
  // shows on tray-open before the next full sync marks it customized.
  const customized = editedSlugSet(trayCustomized ?? [], trayLiveEdits)
  const skillRow = (ref: string, name: string, category: string | null, sub: string, tail = ''): string => {
    const edited = isSlugCustomized(ref, customized)
    const cover = `<span class="cover lib-cover">${skillCover(ref, category)}</span>`
    // An edited skill gains a "See changes" action that opens the viewer window
    // (U7/R14) — the only surface that shows your version vs the author's. It's a
    // span (not a nested button) with stopPropagation, so the row's own click
    // still works. It resolves the lineage ref for the viewer's `?skill=`.
    // One action per row: the row opens the local markdown viewer, and "open on
    // web" lives inside the viewer — no competing web ↗ on the row itself.
    // `ref` may already be the full `@owner/slug` (the flat list's canonical
    // form) or a bare slug — normalize to the bare last segment first, or an
    // owned ref would double to `@owner/@owner/slug` and resolve to nothing.
    const owner = skills.find((x) => x.slug === ref)?.owner ?? null
    const bare = (ref.split('/').pop() ?? ref).replace(/^@/, '')
    const ownedRef = owner ? `@${owner}/${bare}` : bare
    return `<button type="button" class="lib-row lib-skill lib-localview" data-skill-local="${escapeHtml(ownedRef)}">
      ${cover}${nameCol(name, sub, false, edited)}<span class="spacer"></span>
      <span class="lib-tail">${tail}<span class="lib-open">Open<span class="ico lib-open-ico">${ICON.arrowUpRight}</span></span></span>
    </button>`
  }

  const emptyMsg = `<div class="empty-row">No skills yet. Add one and it syncs here.</div>`

  // Flat skill list — every skill as its own row, no kit grouping. Latest uses
  // this (recency-sorted, newest first, with a timestamp) so a freshly-added
  // skill lands at the top as confirmation it arrived; the Skills tab uses it
  // alphabetically (via its Kits/Skills toggle).
  if (opts.view === 'skills') {
    const memberSlugs = kits.flatMap((g) => g.skills.map((sk) => sk.slug))
    const localSlugs = opts.includeLocal ? loose.map((s) => s.slug) : []
    const seen = opts.sort === 'recency' ? skillFirstSeen([...memberSlugs, ...localSlugs]) : null
    const all = [...memberSlugs, ...localSlugs].slice().sort((a, b) =>
      seen
        ? (seen[b] ?? 0) - (seen[a] ?? 0)
        : kitSkillDisplayName(a, skills).localeCompare(kitSkillDisplayName(b, skills)),
    )
    // Latest is a ledger of recent arrivals, not the library — cap it so it
    // never grows past a glance. The rest lives in Skills, one tap away.
    const shown = opts.limit ? all.slice(0, opts.limit) : all
    const rows = shown
      .map((slug) => {
        const when = seen && seen[slug] ? relTime(seen[slug]).replace(/^Synced /, '') : ''
        const tail = when ? `<span class="lib-time">${escapeHtml(when)}</span>` : ''
        return skillRow(slug, kitSkillDisplayName(slug, skills), catOf(slug), subOf(slug), tail)
      })
      .join('')
    const more =
      all.length > shown.length
        ? `<button type="button" class="lib-row lib-more" data-lib-more><span class="lib-sub">${all.length - shown.length} more in Skills</span></button>`
        : ''
    return rows ? rows + more : emptyMsg
  }

  // Grouped "Kits" view. One expandable group per kit (+ the "On this Mac" group).
  const groupRow = (
    key: string,
    coverHtml: string,
    name: string,
    sub: string,
    members: { slug: string; flag?: string }[],
  ): string => {
    const expanded = expandedKits.has(key)
    const inner = members
      .map((m) =>
        skillRow(m.slug, kitSkillDisplayName(m.slug, skills), catOf(m.slug), subOf(m.slug), m.flag ?? ''),
      )
      .join('')
    return `<div class="lib-kit">
      <button type="button" class="lib-row lib-kit-head" data-kit="${escapeHtml(key)}">
        <span class="cover lib-cover">${coverHtml}</span>
        ${nameCol(name, sub, true)}
        <span class="spacer"></span>
        <span class="lib-count">${members.length} skill${members.length === 1 ? '' : 's'}</span>
        <span class="ico chev lib-chev ${expanded ? 'open' : ''}">${ICON.chevDown}</span>
      </button>
      ${expanded ? `<div class="lib-kit-skills${key === kitAnimateRef ? ' animate-in' : ''}">${inner}</div>` : ''}
    </div>`
  }

  // Your kits first, then alphabetical — ownership beats strict A–Z, but stays
  // predictable. ('you' covers the preview owner; real kits match your handle.)
  const myHandle = trayAuth?.whoami?.handle ?? null
  const kitIsMine = (owner: string): boolean => owner === 'you' || (!!myHandle && owner === myHandle)
  const orderedKits = [...kits].sort((a, b) => {
    const A = kitDisplayParts(a.kitRef)
    const B = kitDisplayParts(b.kitRef)
    return (kitIsMine(A.owner) ? 0 : 1) - (kitIsMine(B.owner) ? 0 : 1) || A.name.localeCompare(B.name)
  })
  const kitRows = orderedKits
    .map((g) => {
      const kp = kitDisplayParts(g.kitRef)
      const cover = kitCover(g.skills.map((sk) => ({ ref: sk.slug, category: catOf(sk.slug) })))
      const members = g.skills.map((sk) => ({
        slug: sk.slug,
        flag:
          sk.status === 'skipped'
            ? `<span class="s skip">${sk.reason ? `skipped: ${escapeHtml(sk.reason)}` : 'skipped'}</span>`
            : '',
      }))
      return groupRow(g.kitRef, cover, kp.name, kp.owner ? `@${kp.owner}` : '', members)
    })
    .join('')

  // Unsynced skills pin to the TOP as the upload CTA — the one thing that needs
  // action leads the list, with Upload right on it (Skills tab only; Activity is
  // synced-only). Tapping opens the upload flow, which previews + explains.
  let localGroup = ''
  if (opts.includeLocal && loose.length > 0) {
    const n = loose.length
    localGroup = `<button type="button" class="lib-row lib-cta" data-upload>
      <span class="cover lib-cover">${localCover()}</span>
      ${nameCol('Not synced', `${n} skill${n === 1 ? '' : 's'} only on this device`, true)}
      <span class="spacer"></span>
      <span class="ico chev lib-chev">${ICON.chev}</span>
    </button>`
  }

  return localGroup + kitRows || emptyMsg
}

// Wire the kit expand/collapse for a library list. `repaint` re-renders the host
// view (Activity or Skills) so the toggle works identically in both.
function wireLibrary(repaint: () => void): void {
  // Bottom-fade scroll affordance: the fade (a CSS mask on `.more-below`) shows
  // only while there's more to scroll, so it never dims the last row or footer.
  document.querySelectorAll<HTMLElement>('.lib-list').forEach((el) => {
    const update = () =>
      el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    update()
    el.addEventListener('scroll', update, { passive: true })
  })
  document.querySelectorAll<HTMLElement>('.lib-kit-head[data-kit]').forEach((el) => {
    el.onclick = () => {
      const ref = el.dataset.kit!
      const opening = !expandedKits.has(ref)
      if (opening) expandedKits.add(ref)
      else expandedKits.delete(ref)
      kitAnimateRef = opening ? ref : null
      repaint()
      kitAnimateRef = null
    }
  })
  // Skills tab: the whole row opens the local markdown viewer for that skill.
  document.querySelectorAll<HTMLElement>('[data-skill-local]').forEach((el) => {
    el.onclick = () => void invoke('open_viewer', { skill: el.dataset.skillLocal })
  })
  // Restore (and keep tracking) this view's scroll offset. Every repaint rebuilds
  // the list from scratch — without this, reopening the tray or expanding a kit
  // snaps back to the top. Keyed per view so Latest/Skills don't clobber each
  // other's position.
  const list = document.querySelector<HTMLElement>('.lib-list')
  if (list) {
    const saved = trayScrollByView.get(trayView)
    if (saved) list.scrollTop = saved
    list.addEventListener('scroll', () => trayScrollByView.set(trayView, list.scrollTop), {
      passive: true,
    })
  }
}

// The signed-in user's avatar as a data URI (CLI fetches + encodes it; CSP-safe).
// Fetched once per session, cached; the rail falls back to a monogram until then.
let trayAvatarDataUri: string | null = null
let trayAvatarTint: string | null = null // pastel backing for transparent default faces
let trayAvatarFetched = false
let trayAvatarInFlight = false
let trayAvatarNextTry = 0
/** Min gap between avatar retries, so a signed-out session doesn't spawn the
 *  sidecar on every focus repaint. */
const AVATAR_RETRY_MIN_GAP_MS = 30 * 1000
async function ensureTrayAvatar(repaint: () => void): Promise<void> {
  // Latch on SUCCESS, not on attempt. This used to set `fetched = true` before
  // the invoke, so a single transient miss (cold start, a sidecar busy under a
  // long sync) pinned the rail to the monogram until the app was restarted.
  if (trayAvatarFetched || trayAvatarInFlight || !(await usingCli())) return
  if (Date.now() < trayAvatarNextTry) return
  trayAvatarInFlight = true
  try {
    const parsed = JSON.parse(await invoke<string>('avatar_data_uri')) as {
      data_uri?: string | null
      tint?: string | null
    }
    if (parsed.data_uri) {
      trayAvatarFetched = true
      if (parsed.data_uri !== trayAvatarDataUri) {
        trayAvatarDataUri = parsed.data_uri
        trayAvatarTint = parsed.tint ?? null
        repaint()
      }
    } else {
      // `null` is the signed-out answer. Keep the monogram, and let a later
      // render try again once this machine is connected.
      trayAvatarNextTry = Date.now() + AVATAR_RETRY_MIN_GAP_MS
    }
  } catch {
    // Keep the monogram, but stay retryable — the next render picks it up.
    trayAvatarNextTry = Date.now() + AVATAR_RETRY_MIN_GAP_MS
  } finally {
    trayAvatarInFlight = false
  }
}

async function renderTray() {
  // Paint instantly from last-known state so the panel never waits on the CLI
  // calls (or the network sync) below — they refresh the caches and repaint in
  // place as they land. Skip on a cold first render (nothing cached yet) to
  // avoid flashing the empty state before real data arrives.
  if (!trayUpgradeRequired && (lastSkills.length > 0 || trayAdapters !== null)) {
    paintTray(lastSkills, lastGranted)
  }
  const skills = await getSkills()
  trayAuth = await getAuth()
  if (trayKit === null) trayKit = await getKitStatus()
  if (trayAdapters === null) {
    trayAdapters = await getAdapters()
    traySyncedAt = Date.now()
    // This cold-cache fetch was a real `sync --json` attempt (the launch sync).
    // Stamp it like runSync does, or the daily auto-sync throttle can't see it
    // and fires a redundant sync right after every app launch.
    try {
      localStorage.setItem('lastAutoSync', String(traySyncedAt))
    } catch {
      /* private mode */
    }
  }
  // Local agent detection — loaded separately so it succeeds even when the sync
  // above fails (registry down, disconnected, deleted skill).
  if (trayDetectedAgents === null) trayDetectedAgents = await getDetectedAgents()
  if (trayPending === null) applyPending(await getPending())
  if (trayCustomized === null) trayCustomized = await getCustomized()
  if (!trayShortcut)
    trayShortcut = await invoke<string>('get_shortcut').catch(() => 'Alt+Shift+KeyS')
  const granted = previewInBrowser() && params.get('perm') === 'off' ? false : await axGranted()
  // Pulse the bell once when a new notification has arrived since the last render.
  const pc = trayPending?.length ?? 0
  if (pc > lastPendingCount) badgePulse = true
  lastPendingCount = pc
  // A registry min-version rejection is a hard block: nothing syncs until the
  // app updates, so it overrides the normal tray.
  if (trayUpgradeRequired) {
    paintUpdateBlock()
    return
  }
  paintTray(skills, granted)
  void ensureTrayAvatar(() => paintTray(skills, granted))
}

// Full-panel block shown when the registry's minimum-version gate rejects this
// client. The only way forward is to update — so this is the one non-silent
// update path (reserved for the dormant emergency lever, never everyday updates).
function paintUpdateBlock(): void {
  const canRelaunch = pendingUpdate != null
  // The tray window is transparent; .panel carries the background and rounded
  // corners. Without it this screen floats bare over the desktop.
  app.innerHTML = `<div class="panel"><div class="update-block">
      <span class="update-block-ico">${ICON.refresh}</span>
      <b class="update-block-title">Update Skillet to keep syncing</b>
      <span class="update-block-sub">This version is no longer supported. Update to the latest to reconnect.</span>
      <button type="button" class="act fill update-block-cta" id="update-block-cta">${canRelaunch ? 'Relaunch to update' : 'Get the update'}</button>
      <div class="update-block-foot">
        <button type="button" class="link" id="update-block-retry">Retry</button>
        <button type="button" class="link" id="update-block-quit">Quit</button>
      </div>
    </div></div>`
  document.getElementById('update-block-cta')?.addEventListener('click', () => {
    if (pendingUpdate) void applyUpdateAndRelaunch()
    else void invoke('open_web', { path: '/install' })
  })
  document.getElementById('update-block-quit')?.addEventListener('click', () => invoke('quit_app'))
  const retry = document.getElementById('update-block-retry') as HTMLButtonElement | null
  if (retry) retry.addEventListener('click', () => void retryUpdateBlockCheck(retry))
  fitTrayWindow()
}

// Re-check the version floor from the block screen. If the registry now accepts
// this client (floor lowered / misconfig reverted), clear the flag and leave the
// block; otherwise repaint it. Gives the otherwise-dead-end screen a way out
// without waiting for the ~22h auto-sync.
async function retryUpdateBlockCheck(button: HTMLButtonElement): Promise<void> {
  if (traySyncing) return
  button.disabled = true
  button.textContent = 'Checking…'
  try {
    const raw = await invoke<string>('check_sync')
    const parsed = JSON.parse(raw) as {
      ok?: boolean
      changed?: boolean
      error?: string
      code?: string
    }
    const action = checkSyncAction(parsed)
    if (action.clearSyncError) traySyncError = false
    if (action.clearUpgradeRequired) {
      setTrayUpgradeRequired(false)
      if (action.clearDisconnected) setTrayDisconnected(false)
      await renderTray()
      if (action.runSync) await runSync()
      return
    }
    // Still blocked — repaint restores the button and refreshes the CTA (an
    // update may have finished downloading while we were blocked).
    await renderTray()
  } catch {
    await renderTray()
  }
}

async function signOutFromTray(): Promise<void> {
  stopDeviceSyncStream()
  clearPersistedDeviceSyncSeq()
  await invoke('logout')
  setTrayDisconnected(false)
  trayAvatarDataUri = null
  trayAvatarTint = null
  trayAvatarFetched = false
  trayAvatarNextTry = 0
  trayAuth = null
  trayKit = null
  traySyncKits = null
  trayAdapters = null
  trayPending = null
  trayView = 'home'
  await renderTray()
}

// Chef mascot mark (CSS mask) — same asset as web brand.
function brandMark(extraClass = ''): string {
  const cls = extraClass ? `brand-mark ${extraClass}` : 'brand-mark'
  return `<span class="${cls}" aria-hidden="true"></span>`
}

// Inline SVG icon set (Lucide-ish line icons). All use currentColor so they tint from CSS.
const ICON = {
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 4v5h-5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  arrowUpRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`,
  chevDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  chevLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
  cloudOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a4.5 4.5 0 0 1-1.3-8.8"/><path d="M9 5.5A5 5 0 0 1 18.5 8a4 4 0 0 1 2.4 6.7"/><path d="M3 3l18 18"/></svg>`,
  // Skills = your library (grid of covers). Agents = a robot (your AI runtimes).
  // Sized to fill the ~2–22 box like the bell so the three rail icons match visually.
  skills: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.7"/><rect x="13" y="3" width="8" height="8" rx="1.7"/><rect x="3" y="13" width="8" height="8" rx="1.7"/><rect x="13" y="13" width="8" height="8" rx="1.7"/></svg>`,
  agents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6.5" width="16" height="14" rx="2.6"/><path d="M12 6.5V3.3"/><circle cx="12" cy="2.4" r="1.1"/><path d="M2.5 13v2"/><path d="M21.5 13v2"/><path d="M9 11.5v2.5"/><path d="M15 11.5v2.5"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h9v9"/><path d="M17 7L7 17"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>`,
}

// Monochrome agent brand mark (inline SVG, currentColor) for a runtime name.
function agentLogoSvg(name: string): string | null {
  const n = name.toLowerCase()
  const slug = n.includes('claude')
    ? 'claude'
    : n.includes('cursor')
      ? 'cursor'
      : n.includes('codex')
        ? 'codex'
        : n.includes('chatgpt') || n.includes('openai')
          ? 'openai'
        : n.includes('slack')
          ? 'slack'
        : n.includes('windsurf')
          ? 'windsurf'
          : n.includes('gemini')
            ? 'gemini'
            : n.includes('copilot')
              ? 'copilot'
              : n.includes('zed')
                ? 'zed'
                : n.includes('opencode')
                  ? 'opencode'
                  : n.includes('antigravity')
                    ? 'antigravity'
                    : n.includes('amp')
                      ? 'amp'
                      : n.includes('devin')
                        ? 'devin'
                        : n.includes('kimi')
                          ? 'kimi'
                          : n.includes('roo')
                            ? 'roo'
                            : n.includes('hermes')
                              ? 'hermes'
                              : n.includes('claw')
                                ? 'openclaw'
                                : null
  return slug ? (AGENT_LOGOS[slug] ?? null) : null
}

// Persistent left nav rail (Dropbox-style) — the same rail renders in every view,
// so navigation stays at the edge; you never travel to the top to go back.
// Dropbox-style rail: brand logo pinned at top, main nav (Home/Skills/Agents),
// then globe + account avatar pinned at the bottom (avatar opens Settings).
type RailKey = 'home' | 'skills' | 'agents' | 'settings'
const RAIL_NAV: Array<{ key: RailKey; view: TrayView; label: string; icon: string }> = [
  { key: 'home', view: 'home', label: 'Latest', icon: ICON.bell },
  { key: 'skills', view: 'kit', label: 'Skills', icon: ICON.skills },
  { key: 'agents', view: 'agents', label: 'Agents', icon: ICON.agents },
]
function panelWithRail(active: RailKey, viewHtml: string): string {
  // One source of truth for the rail's two passive signals: the Home bell (pending
  // skill updates) and the account-avatar dot (a downloaded app update awaiting relaunch).
  const badges = resolveRailBadges({
    pendingCount: trayPending?.length ?? 0,
    updateReady: updateReadyVersion != null,
  })
  const pulse = badgePulse // consume once
  badgePulse = false
  const anim = viewAnimDir ? ` anim-${viewAnimDir}` : '' // consume once
  viewAnimDir = ''
  const items = RAIL_NAV.map((n) => {
    const badge =
      n.key === 'home' && badges.home ? `<span class="rail-badge${pulse ? ' pulse' : ''}"></span>` : ''
    // No `title`: the rail already renders the label visibly underneath the icon,
    // so a native tooltip only duplicates it after a delay on every hover.
    return `<button type="button" class="rail-item${active === n.key ? ' on' : ''}" data-view="${n.view}"><span class="rail-ico">${n.icon}${badge}</span><span class="rail-label">${n.label}</span></button>`
  }).join('')
  const auth = trayAuthNow()
  const mono = (auth.displayHandle ?? '?').slice(0, 1)
  // The dot is a visual cue only; the accessible name carries the same signal so
  // screen-reader and keyboard users aren't left with a color-only indicator.
  const accountName = auth.displayHandle ? '@' + escapeHtml(auth.displayHandle) : 'Account'
  const accountTitle = badges.account ? `${accountName}, update ready to install` : accountName
  const accountDot = badges.account ? `<span class="rail-avatar-dot"></span>` : ''
  return `<div class="panel tray tray-railed">
      <nav class="rail">
        <div class="rail-brand">${brandMark('rail-brand-mark')}</div>
        <div class="rail-nav">${items}</div>
        <div class="rail-bottom">
          <button type="button" class="rail-avatar${active === 'settings' ? ' on' : ''}" data-view="settings" aria-label="${accountTitle}">${trayAvatarDataUri ? `<img class="rail-avatar-img" src="${trayAvatarDataUri}"${trayAvatarTint ? ` style="background:${trayAvatarTint}"` : ''} alt="" />` : `<span class="avatar-mono">${escapeHtml(mono)}</span>`}${accountDot}</button>
        </div>
      </nav>
      <div class="view${anim}">${viewHtml}</div>
    </div>`
}
function wireRail(): void {
  document.querySelectorAll<HTMLElement>('.rail [data-view]').forEach((el) => {
    el.onclick = () => {
      const v = el.dataset.view as TrayView
      cancelShortcutRebind?.()
      trayView = v
      paintTray(lastSkills, lastGranted)
    }
  })
}

const PASTE_EXAMPLE_APPS = 'ChatGPT, Slack, email'

function pastePickerPlaceholder(): string {
  return 'Search skills to drop…'
}

function permissionBannerCopy(): { title: string; subtitle: string } | null {
  if (!isMacOsDesktop()) return null
  return {
    title: 'Let Skillet paste for you',
    subtitle: 'One-time macOS permission so we can drop skills into other apps',
  }
}

function onboardingPermissionNeededBody(shortcut: string): string {
  if (isMacOsDesktop()) {
    return `Press ${prettyAccel(shortcut)} in ${PASTE_EXAMPLE_APPS} to drop a skill. macOS will ask once.`
  }
  return `Press ${prettyAccel(shortcut)} in ${PASTE_EXAMPLE_APPS} to drop a skill.`
}

function onboardingPermissionFine(shortcut: string): string {
  const pasteKey = isMacOsDesktop() ? '⌘V' : 'Ctrl+V'
  return `Until then, ${prettyAccel(shortcut)} copies the skill so you can paste it yourself (${pasteKey}).`
}

// Every paint* below rebuilds the panel with `innerHTML`, which loses a click if
// it lands mid-press — see press-guard.ts for why, and for the ordering rules.
const trayPressGuard = createPressGuard()

/** Track presses for the guard above. Registered once, for the tray window. */
function initTrayPressGuard(): void {
  window.addEventListener('pointerdown', () => trayPressGuard.onPointerDown(), true)
  window.addEventListener('pointerup', () => trayPressGuard.onPointerUp(), true)
  window.addEventListener('pointercancel', () => trayPressGuard.onPointerUp(), true)
}

function paintTray(skills: Skill[], granted: boolean) {
  if (trayPressGuard.hold(() => paintTray(skills, granted))) return
  lastSkills = skills
  lastGranted = granted
  if (trayView === 'signin') {
    paintAuthGate(trayAuthNow())
    return
  }
  if (trayView === 'backup') {
    paintBackup(skills)
    return
  }
  if (trayView === 'settings') {
    paintSettings()
    return
  }
  if (trayView === 'agents') {
    paintAgents()
    return
  }
  if (trayView === 'folders') {
    paintSyncedFolders()
    return
  }
  if (trayView === 'kit') {
    const kitAuth = trayAuthNow()
    if (!kitAuth.showAccountKitGroups) {
      trayView = 'signin'
      paintAuthGate(kitAuth)
      return
    }
    paintKitBrowser(skills, trayKit)
    return
  }
  if (previewInBrowser() && params.get('state') === 'disconnected') {
    // Preview-only: demo the revocation gate. This can't ride the HeroCardState
    // whitelist — that path feeds the hero card and bypasses the gate branch.
    paintAuthGate(resolveTrayAuthPresentation(trayAuth ?? null, { disconnected: true }))
    return
  }
  const auth = trayAuthNow()
  const previewState = previewCardStateOverride()
  if (!previewState && !auth.showAccountKitGroups) {
    trayView = 'signin'
    paintAuthGate(auth)
    return
  }
  const cardState =
    previewState ??
    heroCardState({
      linked: auth.showAccountKitGroups,
      syncing: traySyncing,
      syncError: traySyncError,
    })

  // Parked agent folders (U3/R7): while any adapter still needs the macOS
  // folder grant, the tray carries a needs-access notice and the resting
  // status line must not read as plainly synced.
  const parked = parkedNotice(trayAdapters)

  const pending = trayPending ?? []

  // The skills you most recently synced in, as visual confirmation. Prefer the
  // freshly-arrived batch (client-side slug diff); fall back to your current skills.
  const currentSlugs = skills.map((s) => s.slug)
  // A background sync while we already have skills should be invisible — keep the
  // feed and just spin the refresh glyph. Only the very first sync (no data yet)
  // gets the full "Syncing your skills…" state. This stops the aggressive onboarding
  // sync (every 5s) from flashing a full-screen takeover.
  const displayState =
    cardState === 'syncing' && currentSlugs.length > 0 ? 'synced' : cardState
  // Unified skill/kit list — the exact same component the Skills tab uses (kits as
  // expandable cover rows, loose skills as cover rows). Activity sorts newest-first.
  // Show the CACHED list whenever we have skills — even offline. Losing the network
  // shouldn't clear the window; the header carries the state (Offline ↻) and tapping
  // refresh retries. The full "Check your connection" takeover is only for the empty
  // case (offline with nothing cached yet).
  const skillRows =
    currentSlugs.length > 0 && displayState !== 'not-connected'
      ? renderLibraryHtml(skills, {
          sort: 'recency',
          includeLocal: false,
          view: 'skills',
          limit: 10,
          localViewer: true,
        })
      : ''

  // Header: "Latest" title (mirrors "Skills") + the sync time & refresh floated right.
  // The ✓ only shows at rest — a sync that starts inside the 1.4s ✓ window must
  // spin the refresh glyph, never the checkmark.
  // Only an actually-clean sync shows the ✓. runSync sets syncJustSucceeded
  // unconditionally, so a sync that failed inside getAdapters (offline, blocked,
  // disconnected, upgrade-required) must be filtered out here or it flashes a
  // green check next to an error state.
  const showSyncOk =
    syncJustSucceeded &&
    !traySyncing &&
    !traySyncError &&
    !trayApprovalBlocked &&
    !trayUpgradeRequired &&
    !trayDisconnected &&
    parked === null // a parked folder is not a clean sync — no green check
  const syncIco = `<span class="status-sync ${traySyncing ? 'spin' : ''}${showSyncOk ? ' ok' : ''}">${showSyncOk ? ICON.check : ICON.refresh}</span>`
  const timeText =
    displayState === 'syncing'
      ? 'Syncing…'
      : displayState === 'offline'
        ? 'Offline'
        : displayState === 'not-connected'
          ? 'Sign in'
          : (heroStatusOverride(displayState, parked) ??
            relTime(traySyncedAt).replace(/^Synced /, ''))
  const latestRight =
    displayState === 'not-connected'
      ? `<button type="button" class="latest-sync" id="hero-sync"><span class="status-text">${escapeHtml(timeText)}</span></button>`
      : `<button type="button" class="latest-sync" id="hero-sync" title="Refresh"><span class="status-text">${escapeHtml(timeText)}</span>${syncIco}</button>`

  // The one action — pending updates — pins to the TOP of the list with a warm
  // "attention" cover, mirroring the Skills tab's "Not synced" CTA. Accepting
  // happens on the web (first-install/update consent lives there). An approval-
  // blocked sync pins the same row even when the pending list comes back empty
  // (a stale sidecar or reconcile gap must not hide the one action that unblocks).
  const updateLabel = pending.length
    ? `${pending.length} skill update${pending.length === 1 ? '' : 's'}`
    : 'Skill update waiting'
  const updateCta =
    pending.length || trayApprovalBlocked
      ? `<button type="button" class="lib-row" id="updates">
        <span class="cover lib-cover">${updateCover()}</span>
        <span class="lib-name-col"><span class="lib-name lib-kit-name">${updateLabel}</span><span class="lib-sub">Review on the web to accept</span></span>
        <span class="spacer"></span>
        <span class="ico lib-chev lib-ext">${ICON.arrowUpRight}</span>
      </button>`
      : ''

  // One-time skill-stats ask: pinned row like updateCta, gated by
  // shouldShowStatsAsk via refreshStatsAsk (silent-degrade — no card until the
  // sidecar confirms the question is unanswered). Never in preview.
  // A consent prompt must be readable in full — the lib-row grid truncated
  // both lines at tray width, so this is a stacked card of its own.
  const statsCard =
    statsAskState === 'show' && !previewState
      ? `<div class="stats-ask-card">
        <div class="stats-ask-title">See which skills you actually use</div>
        <div class="stats-ask-sub">A private 30-day chart of your skill use, on skillet.md. Counts only, never your prompts.</div>
        <div class="stats-ask-actions"><button type="button" class="stats-ask-btn stats-ask-yes" id="statsyes">Sync my stats</button><button type="button" class="stats-ask-btn stats-ask-no" id="statsno">Keep local</button></div>
      </div>`
      : ''

  // Agents moved to their own tab; Latest keeps the transient post-sync note for
  // per-skill sync failures (surfaced, not hidden as "Offline"). Prunes are
  // silent (R5): an upstream removal is HELD until decided on the web, so any
  // prune that actually runs is something the user did or already approved.
  // Trash stays the safety net either way.
  const footer =
    (parked ? renderParkedNote(parked) : '') +
    (traySyncIssues.length > 0 ? renderSyncIssuesNote() : '')

  // When there's no feed (not synced), fill the body with a centered state instead
  // of a blank void — the status bar carries the headline, this carries the action.
  const emptyState =
    trayApprovalBlocked
      ? `<div class="tray-empty"><span class="ico tray-empty-ico">${ICON.bell}</span><div class="tray-empty-sub">A skill update is waiting for your review before it can sync.</div><button type="button" class="act fill tray-empty-retry" id="reviewupdates">Review on the web</button></div>`
      : displayState === 'syncing'
        ? `<div class="tray-empty"><span class="ico tray-empty-ico spin">${ICON.refresh}</span><div class="tray-empty-sub">Syncing your skills…</div></div>`
        : displayState === 'offline'
          ? `<div class="tray-empty"><span class="ico tray-empty-ico">${ICON.cloudOff}</span><div class="tray-empty-sub">Check your connection, then try again.</div><button type="button" class="act fill tray-empty-retry" id="retrysync">Retry</button></div>`
          : displayState === 'synced' && !skillRows
            ? `<div class="tray-empty"><span class="ico tray-empty-ico">${ICON.skills}</span><div class="tray-empty-sub">No skills yet. Add one and it syncs here.</div></div>`
            : ''

  // Activity mirrors Skills: "Latest" title + sync/refresh right, the one action
  // (updates) pinned to the top of the list, agents as a quiet status footer.
  // With no synced skills, still surface the pending-updates CTA — dropping it in
  // the empty branch hid the one action that unblocks a fresh paired device whose
  // followed content is all first-install-gated. The approval-block emptyState
  // already carries its own review button, so don't double it there.
  const listOrEmpty = skillRows
    ? `<div class="lib-list">${updateCta}${statsCard}${skillRows}</div>`
    : (updateCta || statsCard) && !trayApprovalBlocked
      ? `<div class="lib-list">${updateCta}${statsCard}</div>${emptyState}`
      : emptyState

  app.innerHTML = panelWithRail(
    'home',
    `<div class="view-head"><b>Latest</b>${latestRight}</div>
      ${listOrEmpty}
      ${footer ? `<div class="home-footer">${footer}</div>` : ''}`,
  )
  wireRail()
  document.getElementById('retrysync')?.addEventListener('click', () => void runSync())
  document.getElementById('reviewupdates')?.addEventListener('click', () =>
    invoke('open_web', { path: '/updates' }),
  )
  document.querySelectorAll<HTMLElement>('[data-lib-more]').forEach((el) => {
    el.onclick = () => {
      trayView = 'kit'
      paintTray(skills, granted)
    }
  })
  wireLibrary(() => paintTray(skills, granted))

  // Tapping the card's status line syncs — or routes to sign-in when not connected.
  // This is the manual sync affordance, so it runs user-initiated: it may
  // trigger the one macOS folder-access prompt and record the unlock (U3).
  document.getElementById('hero-sync')?.addEventListener('click', () => {
    if (cardState === 'not-connected') {
      trayView = 'signin'
      paintTray(skills, granted)
      return
    }
    void runSync({ background: false })
  })
  // Parked-folder notice. Sync is a grant affordance, so it runs
  // user-initiated (the only class assessTccRoot lets probe). Settings is the
  // denied path: re-syncing cannot re-prompt a refused grant, so the button
  // has to leave the app.
  document.getElementById('parkedsync')?.addEventListener('click', (e) => {
    const kind = (e.currentTarget as HTMLElement).dataset.kind
    if (kind === 'settings') void invoke('open_folder_access_settings')
    else void runSync({ background: false })
  })
  // Skill-stats ask: either answer marks the question answered account-side
  // (choose sync|local), so no surface re-asks; localStorage only remembers
  // that THIS machine already showed the card.
  const answerStatsAsk = async (sync: boolean) => {
    localStorage.setItem('statsAsked', '1')
    statsAskState = 'hide'
    try {
      await invoke('choose_skill_stats', { sync })
    } catch {
      // Old sidecar or transient failure: the account stays unasked, so the
      // CLI/web asks still work. This machine just stops showing the card.
    }
    paintTray(lastSkills, lastGranted)
  }
  document.getElementById('statsyes')?.addEventListener('click', () => void answerStatsAsk(true))
  document.getElementById('statsno')?.addEventListener('click', () => void answerStatsAsk(false))
  if (statsAskState !== 'show' && !previewState && auth.showAccountKitGroups) {
    // Re-probe on feed paints while hidden: stats accumulate over days, and
    // the card should appear on the first open after they exist. localStorage
    // and the chosen flag keep this from ever re-asking once answered.
    void refreshStatsAsk()
  }
  document.getElementById('updates')?.addEventListener('click', () =>
    invoke('open_web', { path: '/updates' }),
  )
  document.getElementById('dismisssyncissue')?.addEventListener('click', () => {
    traySyncIssues = []
    paintTray(skills, granted)
  })
  document.getElementById('retrysyncissue')?.addEventListener('click', () => {
    void runSync().then(() => paintTray(lastSkills, lastGranted))
  })
  fitTrayWindow()
}

// Needs-access notice (U3/R7): one row, visible for as long as any agent
// folder stays parked. The label and the behaviour both come from
// parkedNoticeCopy — an ungranted folder gets a user-initiated sync (the flow
// allowed to trigger the macOS prompt and record the grant), a DENIED one gets
// System Settings, because macOS never re-prompts after a refusal.
function renderParkedNote(notice: ParkedNotice): string {
  const copy = parkedNoticeCopy(notice)
  return `<div class="row action syncissue"><div class="bcol"><b>${escapeHtml(copy.title)}</b><span>${escapeHtml(copy.detail)}</span></div><span class="spacer"></span><button class="link" id="parkedsync" data-kind="${copy.action.kind}">${escapeHtml(copy.action.label)}</button></div>`
}

// Transient post-sync note: per-skill failures the registry reported. Surfaces
// the reason (and a Retry) instead of a blank "Offline" — the registry was
// reachable, one or more skills just failed.
function renderSyncIssuesNote(): string {
  const { title, detail } = syncIssueNote(traySyncIssues)
  return `<div class="row action syncissue"><div class="bcol"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div><span class="spacer"></span><button class="link" id="retrysyncissue">Retry</button><button class="link" id="dismisssyncissue">Dismiss</button></div>`
}

// The mini logo used in the agent strip / rows.
function agentGlyph(name: string): string {
  const logo = agentLogoSvg(name)
  return logo
    ? `<span class="agent-logo">${logo}</span>`
    : `<span class="agent-logo agent-logo-fallback">${escapeHtml(pretty(name).slice(0, 1))}</span>`
}

/**
 * Run a sync (pull + prune) and refresh the tray. Shared by the manual button
 * and the opportunistic daily auto-sync. Records the time so the throttle can
 * skip until a day has passed.
 *
 * `background` defaults to true (fail-closed, U3): only the explicit sync
 * affordances (the hero sync button, the parked-folder Sync now) pass false —
 * a user-initiated run may read agent folders that still need the macOS
 * folder-access grant, prompting once and recording the unlock. Automatic
 * syncs (launch, daily, tray-open check, SSE push, post-connect/publish)
 * stay background and never trigger the prompt.
 */
async function runSync(opts: { background?: boolean } = {}): Promise<void> {
  const background = opts.background !== false
  if (traySyncing) {
    syncPending = true
    if (!background) syncPendingUserInitiated = true
    return
  }
  const started = Date.now()
  traySyncing = true
  syncPending = false
  // A sync starting inside the 1.4s ✓ window must not paint a spinning checkmark.
  if (syncOkRevertTimer !== null) window.clearTimeout(syncOkRevertTimer)
  syncOkRevertTimer = null
  syncJustSucceeded = false
  await renderTray() // spinner
  trayAdapters = await getAdapters({ background })
  traySyncedAt = Date.now()
  try {
    localStorage.setItem('lastAutoSync', String(traySyncedAt))
  } catch {
    /* private mode */
  }
  trayKit = await getKitStatus()
  trayAuth = await getAuth()
  // A sync is exactly when web approvals reconcile into the lock — refetch the
  // pending queue too, or the "N skill updates" row lingers until the 2-min poll.
  // A now-empty queue also clears any stale approval-block latch (applyPending).
  applyPending(await getPending())
  // Keep the spinner up for a minimum beat so even an instant sync reads as work.
  const elapsed = Date.now() - started
  if (elapsed < 550) await new Promise((r) => setTimeout(r, 550 - elapsed))
  traySyncing = false
  const needsFollowUp = syncPending
  const followUpUserInitiated = syncPendingUserInitiated
  syncPending = false
  syncPendingUserInitiated = false
  // Acknowledge the manual sync with a brief ✓, then revert to the refresh glyph.
  syncJustSucceeded = true
  await renderTray()
  syncOkRevertTimer = window.setTimeout(() => {
    syncOkRevertTimer = null
    syncJustSucceeded = false
    void renderTray()
  }, 1400)
  if (needsFollowUp) await runSync({ background: !followUpUserInitiated })
}

// Opportunistic auto-sync: NO installed daemon. We sync inside the app the user
// already chose to run — on launch and at most once a day while it stays open
// (an hourly clock check that only syncs when stale; 304/ETag makes the no-op
// cheap). Quitting the app stops everything. Headless users cron `skillet sync`.
const AUTO_SYNC_MIN_GAP_MS = 22 * 60 * 60 * 1000 // ~daily, with slack
/** Min gap between tray-focus manifest checks (full sync only when changed). */
const TRAY_OPEN_CHECK_MIN_GAP_MS = 90 * 1000
/**
 * Background pollers no-op while unpaired — every registry-bound call would
 * just bounce off the CLI's auth_required guard and repaint the gate. Uses the
 * cached auth when present (renderTray refreshes it on every tray open, and
 * the in-app connect handlers overwrite it), so pairing from another surface
 * resumes the pollers on the next tray open without an extra subprocess per
 * tick. Only the cold-start gap (pollers firing before the first render)
 * fetches. NOT gated on the sticky disconnected flag — see isUnpairedAuth.
 */
async function trayUnpaired(): Promise<boolean> {
  if (!(await usingCli())) return false // browser preview demos the linked tray
  if (trayAuth === undefined) trayAuth = await getAuth()
  return isUnpairedAuth(trayAuth)
}
async function maybeAutoSync(): Promise<void> {
  if (!(await usingCli())) return // nothing to sync without the CLI sidecar
  if (await trayUnpaired()) return // pairing-first: the gate is the only surface
  let last = 0
  try {
    last = Number(localStorage.getItem('lastAutoSync') ?? 0)
  } catch {
    /* ignore */
  }
  if (Date.now() - last < AUTO_SYNC_MIN_GAP_MS) return
  await runSync()
}

async function maybeSyncOnTrayOpen(): Promise<void> {
  if (traySyncing) return
  if (!(await usingCli())) return
  // Unpaired: skip BEFORE the throttle bookkeeping so the first check after
  // pairing isn't swallowed by a lastTrayCheckAt stamped while gated.
  if (await trayUnpaired()) return
  let lastCheck = 0
  try {
    lastCheck = Number(localStorage.getItem('lastTrayCheckAt') ?? 0)
  } catch {
    /* ignore */
  }
  const now = Date.now()
  if (!shouldRunTrayOpenCheck(now, lastCheck, TRAY_OPEN_CHECK_MIN_GAP_MS)) return
  try {
    localStorage.setItem('lastTrayCheckAt', String(now))
  } catch {
    /* ignore */
  }
  try {
    const raw = await invoke<string>('check_sync')
    const parsed = JSON.parse(raw) as {
      changed?: boolean
      ok?: boolean
      error?: string
      code?: string
      unionPull?: unknown[]
      pull?: unknown[]
    }
    const action = checkSyncAction(parsed)
    if (action.setDisconnected && setTrayDisconnected(true)) await renderTray()
    if (action.clearDisconnected && setTrayDisconnected(false)) await renderTray()
    if (action.setUpgradeRequired && setTrayUpgradeRequired(true)) await renderTray()
    if (action.clearUpgradeRequired && setTrayUpgradeRequired(false)) await renderTray()
    // The check proved the registry answered: a stale "Offline" latch from an
    // earlier failed full sync is wrong now. Only a full sync sets the latch.
    if (action.clearSyncError && traySyncError) {
      traySyncError = false
      await renderTray()
    }
    if (action.runSync) {
      await runSync()
    }
    // Read-only (KTD5): surface a local edit a full sync hasn't reconciled yet.
    // No state/disk mutation — just refresh the "Edited locally" set and repaint.
    const live = await getLiveEdits()
    if (JSON.stringify(live) !== JSON.stringify(trayLiveEdits)) {
      trayLiveEdits = live
      if (view === 'tray') paintTray(lastSkills, lastGranted)
    }
  } catch (e) {
    const kind = classifySyncFailure({ message: String(e) })
    if (kind === 'disconnected') {
      if (setTrayDisconnected(true)) await renderTray()
      return
    }
    // Unpaired guard tripped mid-flight (e.g. signed out between the check
    // above and the invoke) — the auth gate is the surface; no fallback sync.
    if (kind === 'auth-required') return
    let lastAuto = 0
    try {
      lastAuto = Number(localStorage.getItem('lastAutoSync') ?? 0)
    } catch {
      /* ignore */
    }
    if (shouldFallbackSyncOnCheckError(now, lastAuto, AUTO_SYNC_MIN_GAP_MS)) {
      await runSync().catch(() => undefined)
    }
  }
}

// U12: cheap pending refresh while the tray window is open. `pending_updates`
// already reflects the account-scoped decisions (CLI reconciles on every call),
// so re-fetching it picks up a web/desktop approval promptly — distinct from the
// ~daily full sync above.
const PENDING_POLL_MS = 2 * 60 * 1000
async function refreshPending(): Promise<void> {
  if (await trayUnpaired()) return // gate showing — nothing account-scoped to poll
  applyPending(await getPending())
  await renderTray()
}

function stopDeviceSyncStream(): void {
  deviceSyncStream?.stop()
  deviceSyncStream = null
  deviceSyncStreamStarting = false
}

async function getDeviceSyncStreamConfig(): Promise<DeviceSyncStreamConfig | null> {
  try {
    const raw = await invoke<string>('device_sync_stream_config')
    const parsed = JSON.parse(raw) as { registryUrl?: unknown; deviceToken?: unknown }
    if (typeof parsed.registryUrl !== 'string' || typeof parsed.deviceToken !== 'string') return null
    if (!parsed.registryUrl || !parsed.deviceToken) return null
    return { registryUrl: parsed.registryUrl, deviceToken: parsed.deviceToken }
  } catch {
    return null
  }
}

async function ensureDeviceSyncStream(): Promise<void> {
  if (deviceSyncStream || deviceSyncStreamStarting) return
  if (!(await usingCli())) return
  if (await trayUnpaired()) {
    stopDeviceSyncStream()
    return
  }
  deviceSyncStreamStarting = true
  const config = await getDeviceSyncStreamConfig()
  deviceSyncStreamStarting = false
  if (!config || deviceSyncStream) return
  deviceSyncStream = startDeviceSyncStream({
    config,
    onSyncRequired: () => runSync(),
    onError: () => undefined,
  })
}

// Sign-in gate — the only tray surface until registry-linked. Pair code only;
// accounts are created on the web (the "Open skillet.md" path).
function paintAuthGate(auth: ReturnType<typeof resolveTrayAuthPresentation>) {
  const noun = deviceNoun()
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  const title = auth.disconnected ? `Reconnect ${noun}` : `Connect ${noun}`
  const footLogout = auth.canSignOut
    ? `<button class="link" id="logout">Log out</button>`
    : ''

  app.innerHTML = `
    <div class="panel tray">
      <div class="head">${brandMark('logo')}<span class="brand">Skillet</span><span class="spacer"></span></div>
      <div class="appr auth-gate">
        <div class="auth-gate-intro"><b>${escapeHtml(title)}</b>${
          auth.disconnected
            ? `<span>Your skills are safe. Syncing resumes when you do.</span>`
            : `<span>Skills you add on Skillet land in your agents here.</span>`
        }</div>
        <div class="gate-step"><span>Get your pair code at</span><button class="gate-link" id="web">skillet.md/settings ↗</button></div>
        ${pairCodeBoxesHtml('code-boxes')}
        <div class="appr-msg" id="msg"></div>
        <div class="appr-actions"><button class="act fill" id="go" disabled>Connect ${Noun}</button></div>
        <div class="gate-fine">No account? Getting a code creates one. Connecting never uploads your local skills.</div>
      </div>
      <div class="foot">${footLogout}<span class="spacer"></span><div class="footright"><button class="link" id="quit">Quit</button></div></div>
    </div>`

  const msg = document.getElementById('msg')!
  const go = document.getElementById('go') as HTMLButtonElement
  let connecting = false
  // The button is the state: resting + disabled until the code is whole,
  // committed black once it is, progress label while the claim runs.
  const syncGo = () => {
    if (connecting) return
    go.disabled = extractPairCode(getCode()) === null
    go.textContent = `Connect ${Noun}`
  }
  document.getElementById('web')!.onclick = () =>
    void invoke('open_web', { path: '/settings' })
  document.getElementById('quit')!.onclick = () => invoke('quit_app')
  document.getElementById('logout')?.addEventListener('click', () => void signOutFromTray())
  const submit = async () => {
    if (connecting) return
    const raw = getCode()
    const code = extractPairCode(raw)
    if (!code) {
      msg.textContent = pairCodeInputError(raw)
      return
    }
    msg.textContent = ''
    connecting = true
    go.disabled = true
    go.textContent = 'Connecting…'
    try {
      const res = parseCliJson<{ ok: boolean; error?: string; handle?: string | null }>(
        await invoke<string>('connect', { pairCode: code }),
        'connect',
      )
      if (res.ok) {
        setTrayDisconnected(false)
        trayView = 'home'
        trayAuth = await getAuth()
        trayKit = null
        traySyncKits = null
        trayAdapters = null
        await runSync()
        void ensureDeviceSyncStream()
      } else {
        msg.textContent = res.error ?? 'Could not connect with that code.'
      }
    } catch (e) {
      msg.textContent = cleanCliError(String(e))
    } finally {
      connecting = false
      syncGo()
    }
  }
  document.getElementById('go')!.onclick = submit
  const getCode = wirePairCodeBoxes('code-boxes', () => void submit(), '', syncGo)
  syncGo()
  fitTrayWindow()
}

function openBackupView(skills: Skill[], granted: boolean) {
  backupMsg = ''
  backupResult = null
  trayView = 'backup'
  viewAnimDir = 'push'
  paintTray(skills, granted)
}

// One finding as a sentence, in the scanner's own voice: the shared vocabulary
// (@skillet/protocol/scan-vocabulary) is the single source for finding copy —
// the web trust panel reads the same entries, so the tray never invents a
// parallel dialect. Unknown categories (an older client against a newer
// registry) fall back to the sentence-cased id.
function findingSentence(f: UploadFinding): string {
  const entry = vocabularyEntry(f.category)
  const label = entry?.label ?? f.category.replace(/-/g, ' ')
  return `${label} at line ${f.line} of ${f.file}.`
}

// The fix line for a blocked section: the vocabulary's own `fix` when every
// finding agrees on a category, a neutral line when they don't.
function blockedFixLine(groups: { slug: string; findings: UploadFinding[] }[]): string {
  const categories = new Set(groups.flatMap((g) => g.findings.map((f) => f.category)))
  const only = categories.size === 1 ? vocabularyEntry([...categories][0])?.fix : undefined
  return only ?? 'Remove the flagged content and upload again.'
}

// The post-upload result pane: what uploaded, what was blocked and why in
// plain sentences, what was flagged-but-published. Takes the full pane — the
// checklist's job ended at the click, and a footer strip can't hold a
// multi-skill explanation. One action (Done); the header chevron returns to
// the checklist for a fix-and-retry.
function paintBackupResult(skills: Skill[]) {
  const r = backupResult
  if (!r) return
  const bare = (slug: string) => (slug.split('/').pop() ?? slug).replace(/^@/, '')
  const CAP = 8
  // Every section names skills the same way: one row per skill, same style.
  const nameRow = (slug: string) => `<div class="up-result-skill">${escapeHtml(bare(slug))}</div>`
  const uploadedRows =
    r.published.slice(0, CAP).map(nameRow).join('') +
    (r.published.length > CAP ? `<div class="up-result-why">and ${r.published.length - CAP} more</div>` : '')
  const group = (g: { slug: string; findings: UploadFinding[] }) =>
    `${nameRow(g.slug)}${g.findings
      .slice(0, 3)
      .map((f) => `<div class="up-result-why">${escapeHtml(findingSentence(f))}</div>`)
      .join('')}${g.findings.length > 3 ? `<div class="up-result-why">and ${g.findings.length - 3} more findings.</div>` : ''}`

  app.innerHTML = panelWithRail(
    'skills',
    `<div class="view-head drill-head"><button type="button" class="back-ico" id="back">${ICON.chevLeft}</button><b>Upload skills</b></div>
      <div class="feed up-result">
        ${
          r.published.length
            ? `<div class="up-result-sec"><div class="up-result-title">Uploaded ${r.published.length} skill${r.published.length === 1 ? '' : 's'}</div>${uploadedRows}</div>`
            : ''
        }
        ${
          r.blocked.length
            ? `<div class="up-result-sec"><div class="up-result-title up-result-err">Blocked ${r.blocked.length}</div>${r.blocked.map(group).join('')}<div class="up-result-note">${escapeHtml(blockedFixLine(r.blocked))} Blocked skills keep working locally.</div></div>`
            : ''
        }
      </div>
      <div class="up-actions">
        <button type="button" class="act fill" id="resultdone">Done</button>
      </div>`,
  )
  wireRail()
  document.getElementById('back')!.onclick = () => {
    backupResult = null
    paintBackup(skills)
  }
  document.getElementById('resultdone')!.onclick = () => {
    backupResult = null
    backupMsg = ''
    uploadSelected = null
    viewAnimDir = 'pop'
    trayView = 'kit'
    paintTray(lastSkills, lastGranted)
    // Refresh once the pop slide settles so just-uploaded skills paint fresh.
    setTimeout(() => {
      if (trayView === 'kit') void renderTray()
    }, 240)
  }
}

function paintBackup(skills: Skill[]) {
  // Self-guard: failure repaints inside upload handlers must not resurface a
  // live upload UI over the reconnect gate (e.g. revoked mid-upload).
  const auth = trayAuthNow()
  if (!auth.showAccountKitGroups) {
    trayView = 'signin'
    paintAuthGate(auth)
    return
  }
  if (backupResult) {
    paintBackupResult(skills)
    return
  }
  const candidates = capturableSkills(skills)
  // Full repaints replace the list DOM, which would snap the checklist back to
  // the top on every row toggle. Carry the scroll position across the rebuild.
  const listScrollTop = document.querySelector<HTMLElement>('.up-list')?.scrollTop ?? 0
  // Default to all selected; keep the set stable across repaints.
  if (uploadSelected === null) uploadSelected = new Set(candidates.map((s) => s.slug))
  const selected = uploadSelected
  const selectedCount = candidates.filter((s) => selected.has(s.slug)).length
  const allOn = selectedCount === candidates.length && candidates.length > 0

  const back = () => {
    trayView = 'kit' // upload is launched from Skills — return there
    backupMsg = ''
    backupResult = null
    backupBusy = false
    importBusy = false
    uploadSelected = null
    // Single paint from cache so the pop slide isn't clobbered by a double-paint,
    // then refresh silently once the slide has settled (fresh data after an upload).
    viewAnimDir = 'pop'
    paintTray(lastSkills, lastGranted)
    setTimeout(() => {
      if (trayView === 'kit') void renderTray()
    }, 240)
  }

  // Where local skills are ACTIVE — the agents Skillet materializes into. This
  // reframes the row from "sitting in a ~/.skillet folder" to "live in your
  // agents" (which is what a local skill actually is). Uniform across skills, so
  // it reads as "these are already everywhere you work; back them up."
  const activeAgents = (trayAdapters ?? [])
    .filter((a) => a.status === 'materialized')
    .map((a) => pretty(a.name))
  const activeLabel = activeAgents.length
    ? `In ${activeAgents.slice(0, 3).join(' · ')}${activeAgents.length > 3 ? ` +${activeAgents.length - 3}` : ''}`
    : 'Local skill, not backed up'
  const skillRows = candidates.length
    ? candidates
        .map((s) => {
          const on = selected.has(s.slug)
          // Sub shows the local PATH (this is an upload/backup context — where the
          // file lives is what matters), falling back to where it's active. The
          // hover icon opens the skill in the popup viewer to read before uploading;
          // clicking the ROW toggles selection.
          const bare = (s.slug.split('/').pop() ?? s.slug).replace(/^@/, '')
          const ref = s.owner ? `@${s.owner}/${bare}` : bare
          const sub = s.path ? homeShort(s.path) : activeLabel
          return `<div class="up-row${on ? ' on' : ''}" data-row="${escapeHtml(s.slug)}" title="${escapeHtml(s.name)}">
              <button type="button" class="up-check" data-check="${escapeHtml(s.slug)}" title="${on ? 'Deselect' : 'Select'}">${on ? `<span class="ico ck">${ICON.check}</span>` : ''}</button>
              <span class="cover up-cover">${skillCover(s.slug, s.category)}</span>
              <span class="feed-col"><span class="feed-name">${escapeHtml(s.name)}</span><span class="feed-sub">${escapeHtml(sub)}</span></span>
              ${s.path ? `<button type="button" class="ico mut up-ext" data-skill-local="${escapeHtml(ref)}" title="Open in viewer">${ICON.external}</button>` : ''}
            </div>`
        })
        .join('')
    : `<div class="empty-row">${escapeHtml(uploadEmptyHint())}</div>`

  app.innerHTML = panelWithRail(
    'skills',
    `<div class="view-head drill-head"><button type="button" class="back-ico" id="back">${ICON.chevLeft}</button><b>Upload skills</b></div>
      <div class="up-controls">
        <button type="button" class="up-selectall${allOn ? ' on' : ''}" id="selectall"><span class="up-check">${allOn ? `<span class="ico ck">${ICON.check}</span>` : ''}</span><span class="up-selectall-label">${allOn ? 'Deselect all' : 'Select all'}</span></button>
        <span class="spacer"></span>
        <button type="button" class="up-find" id="importfirst" title="${escapeHtml(findOnDeviceLabel(importBusy))}" ${importBusy || backupBusy ? 'disabled' : ''}><span class="ico${importBusy ? ' spin' : ''}">${ICON.refresh}</span></button>
      </div>
      <div class="feed up-list">${skillRows}</div>
      <div class="up-privacy">
        <div class="up-note"><span class="ico up-lock">${ICON.lock}</span>Uploads are private, only you see them. They back up and sync to your devices.</div>
      </div>
      ${backupMsg ? `<div class="appr-msg up-msg" id="backupmsg">${escapeHtml(backupMsg)}</div>` : ''}
      <div class="up-actions">
        <button type="button" class="act fill" id="backupgo" ${backupBusy || selectedCount === 0 ? 'disabled' : ''}>${backupBusy ? 'Uploading…' : `Upload ${selectedCount} skill${selectedCount === 1 ? '' : 's'}`}</button>
      </div>`,
  )
  wireRail()
  const upList = document.querySelector<HTMLElement>('.up-list')
  if (upList && listScrollTop > 0) upList.scrollTop = listScrollTop

  document.getElementById('back')!.onclick = back
  const toggle = (slug: string) => {
    if (selected.has(slug)) selected.delete(slug)
    else selected.add(slug)
    paintBackup(skills)
  }
  // Clicking anywhere on the row toggles selection (it's a checklist).
  document.querySelectorAll<HTMLElement>('.up-row[data-row]').forEach((row) => {
    row.onclick = () => toggle(row.dataset.row!)
  })
  document.querySelectorAll<HTMLElement>('.up-check[data-check]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation() // the row already toggles; don't double-fire
      toggle(el.dataset.check!)
    }
  })
  // The hover icon opens the skill in the popup viewer to read before uploading
  // (same viewer as the Skills tab) — without toggling the row's selection.
  document.querySelectorAll<HTMLElement>('.up-ext[data-skill-local]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation()
      void invoke('open_viewer', { skill: el.dataset.skillLocal })
    }
  })
  document.getElementById('selectall')!.onclick = () => {
    if (allOn) selected.clear()
    else candidates.forEach((s) => selected.add(s.slug))
    paintBackup(skills)
  }
  document.getElementById('importfirst')!.addEventListener('click', async () => {
    if (importBusy || backupBusy) return
    importBusy = true
    backupMsg = 'Looking for skills in Cursor, Claude, and other tools…'
    paintBackup(skills)
    try {
      await invoke<string>('import_discovered')
      importBusy = false
      backupMsg = ''
      trayKit = null
      trayAdapters = null // refresh agents too, not just the kit
      uploadSelected = null
      const fresh = await getSkills()
      paintBackup(fresh)
    } catch (e) {
      backupMsg = humanizeAppError(String(e))
      importBusy = false
      paintBackup(skills)
    }
  })
  document.getElementById('backupgo')!.addEventListener('click', async () => {
    const slugs = candidates.filter((s) => selected.has(s.slug)).map((s) => s.slug)
    if (backupBusy || slugs.length === 0) return
    backupBusy = true
    backupMsg = 'Uploading to your profile…'
    backupResult = null // clear a prior attempt's result before this run
    paintBackup(skills)
    try {
      // Only the checked skills upload, always private. Skills go to the
      // profile kit — no custom kit is created or named.
      const raw = await invoke<string>('upload_skills', { slugs, public: false })
      const res = parseCliJson<UploadResultJson>(raw, 'upload')
      const outcome = uploadOutcome(res, humanizeAppError)
      if (outcome.kind === 'empty' || (outcome.kind === 'error' && !(outcome.blocked?.length))) {
        // Nothing to itemize (empty selection, network/auth failure): the
        // inline message on the checklist is the whole story.
        backupMsg = outcome.kind === 'empty' ? uploadEmptyHint() : outcome.message
        backupBusy = false
        paintBackup(skills)
        return
      }
      backupBusy = false
      backupMsg = ''
      if (outcome.kind === 'error') {
        // Everything was refused (scan_blocked): the result pane itemizes the
        // findings with the fix line instead of one long red sentence.
        backupResult = { published: [], blocked: outcome.blocked ?? [] }
        paintBackup(skills)
        return
      }
      uploadSelected = null
      trayKit = null
      trayAdapters = null
      // Only a scan block earns the result pane. Warn-tier findings stay off
      // this surface by design (see backupResult); a partial whose failures
      // have no findings (network, auth) keeps the inline message — transport
      // errors don't need a page.
      const blocked = outcome.kind === 'partial' ? (outcome.blocked ?? []) : []
      if (blocked.length > 0) {
        backupResult = { published: outcome.publishedSlugs, blocked }
        paintBackup(await getSkills())
        // Published skills sync in the background while the result is read.
        if (outcome.publishedSlugs.length > 0) void runSync()
        return
      }
      if (outcome.kind === 'partial') {
        backupMsg = outcome.message
        paintBackup(await getSkills())
        void runSync()
        return
      }
      backupMsg = ''
      trayView = 'home'
      await runSync()
    } catch (e) {
      backupMsg = humanizeAppError(String(e))
      backupResult = null // this failure is unrelated to any prior scan result
      backupBusy = false
      paintBackup(skills)
    }
  })
  fitTrayWindow()
}

// Settings — rebind the global shortcut by recording the next key combo.

function paintKitBrowser(skills: Skill[], kit: KitStatus | null) {
  const auth = trayAuthNow()
  // Grouped by kit (+ an "On this Mac" group for local skills), or a flat skill list.
  const groupBlocks = auth.showAccountKitGroups
    ? renderLibraryHtml(skills, { sort: 'kit', includeLocal: true, view: libView, localViewer: true })
    : `<div class="empty-row">Sign in to pull kits from your account.</div>`

  // Counts move INTO the tabs (Kits N / Skills N), so the subtitle line is gone.
  // "Not synced" lives as the pinned CTA row at the top of the list, not here.
  const syncKits = resolveTraySyncKitsForTray(kit)
  const kitCount = syncKits.length
  const skillCount = skills.length

  app.innerHTML = panelWithRail(
    'skills',
    `<div class="view-head">
        <b>Skills</b>
        ${
          auth.showAccountKitGroups
            ? `<span class="lib-toggle" role="tablist">
          <button type="button" class="lib-toggle-btn${libView === 'kits' ? ' on' : ''}" data-view="kits">Kits <span class="lib-toggle-n">${kitCount}</span></button>
          <button type="button" class="lib-toggle-btn${libView === 'skills' ? ' on' : ''}" data-view="skills">Skills <span class="lib-toggle-n">${skillCount}</span></button>
        </span>`
            : `<span class="view-head-sub">Sign in to pull kits from your account</span>`
        }
      </div>
      <div class="lib-list kit-browser">${groupBlocks}</div>`,
  )
  wireRail()
  wireLibrary(() => paintKitBrowser(skills, kit))
  document.querySelectorAll<HTMLElement>('.lib-toggle-btn[data-view]').forEach((el) => {
    el.onclick = () => {
      libView = el.dataset.view === 'skills' ? 'skills' : 'kits'
      paintKitBrowser(skills, kit)
    }
  })
  document
    .querySelector<HTMLElement>('[data-upload]')
    ?.addEventListener('click', () => openBackupView(skills, lastGranted))
  fitTrayWindow()
}

function paintAgents(): void {
  // Two ways skills reach an agent, made legible:
  //   1. As FILES — Skillet writes into the agent's skills dir; it auto-loads.
  //      Global (write once): Claude Code, Codex, Devin, Hermes, OpenClaw, and
  //      Cursor (which reads the same ~/.agents/skills). Project editors like
  //      Windsurf only load per-project files.
  //   2. By PASTE — chat apps with no file access (ChatGPT, Slack, anything);
  //      press the shortcut to drop a skill into the chat.
  // Registry-independent: which agents are on this machine comes from a local scan
  // (`trayDetectedAgents`), NOT the sync — so a failing sync never blanks the facepile.
  const detected = (trayDetectedAgents ?? []).filter((a) => a.status !== 'skipped-not-detected')
  const shortcut = trayShortcut ? prettyAccel(trayShortcut) : 'Alt+Shift+S'
  const needsPerm = permissionBannerCopy() != null && !lastGranted

  const syncedBar = detected.length
    ? `<button type="button" class="lib-row synced-bar" id="synced-open" title="Synced folders">
          <span class="cover lib-cover synced">${ICON.check}</span>
          <span class="lib-name-col"><span class="lib-name lib-kit-name">Synced to your agents</span><span class="lib-sub">Every skill loads automatically</span></span>
          <span class="spacer"></span>
          <span class="ico chev lib-chev">${ICON.chev}</span>
        </button>`
    : `<div class="lib-row synced-bar off">
          <span class="cover lib-cover">${ICON.agents}</span>
          <span class="lib-name-col"><span class="lib-name lib-kit-name">No agents detected</span><span class="lib-sub">Install Claude Code, Cursor, or Codex</span></span>
        </div>`
  app.innerHTML = panelWithRail(
    'agents',
    `<div class="view-head">
        <b>Agents</b>
      </div>
      <div class="agents-view">
        ${syncedBar}
        <div class="how-label">Two ways to use</div>
        <div class="agents-sec">
          <div class="sec-content">
            <div class="sec-title">Run /skillet in your agent</div>
            <p class="chan-cap">Type /skillet and describe your task. Skillet picks the best skill for your agent.</p>
            <div class="chan-cmd"><span class="cmd-ref">/skillet <span class="cmd-arg">&lt;task&gt;</span></span></div>
          </div>
        </div>
        <div class="agents-sec">
          <div class="sec-content">
            <div class="sec-title">Open the skill panel</div>
            <p class="chan-cap">Press the shortcut to pick a skill and paste it into ChatGPT, Slack, or any app you type in.</p>
            ${
              needsPerm
                ? `<button type="button" class="cmd-grant" id="agents-grant">Grant Access</button>
                  <p class="chan-cmd-note">Requires accessibility access.</p>`
                : `<div class="chan-cmd"><button type="button" class="cmd-key cmd-key-btn" id="rebind-shortcut" title="Click to set a new shortcut">${recording ? 'Press keys…' : escapeHtml(shortcut)}</button></div>`
            }
          </div>
        </div>
      </div>`,
  )
  wireRail()
  document.getElementById('synced-open')?.addEventListener('click', () => {
    trayView = 'folders'
    viewAnimDir = 'push'
    paintTray(lastSkills, lastGranted)
  })
  document.getElementById('agents-grant')?.addEventListener('click', () =>
    invoke('request_accessibility'),
  )
  document.getElementById('rebind-shortcut')?.addEventListener('click', () =>
    startShortcutRebind(paintAgents),
  )
  fitTrayWindow()
}

// Drill-in from the Agents "Synced to your agents" bar: the folders Skillet writes
// each agent's skills into. One row per detected agent (name over its folder path).
function paintSyncedFolders(): void {
  const detected = (trayDetectedAgents ?? []).filter(
    (a) => a.status !== 'skipped-not-detected' && a.targetDir,
  )
  const folderRows = detected
    .map(
      (a) =>
        `<button type="button" class="folder-row" data-dir="${escapeHtml(a.targetDir!)}" title="${escapeHtml(a.targetDir!)}">
          <span class="folder-glyph">${agentGlyph(a.name)}</span>
          <span class="folder-col">
            <span class="folder-name">${escapeHtml(pretty(a.name))}</span>
            <span class="folder-path">${escapeHtml(homeShort(a.targetDir!))}</span>
          </span>
          <span class="spacer"></span>
          <span class="lib-open">Open<span class="ico lib-open-ico">${ICON.arrowUpRight}</span></span>
        </button>`,
    )
    .join('')
  const back = () => {
    trayView = 'agents'
    viewAnimDir = 'pop'
    paintTray(lastSkills, lastGranted)
  }
  app.innerHTML = panelWithRail(
    'agents',
    `<div class="view-head drill-head"><button type="button" class="back-ico" id="back">${ICON.chevLeft}</button><b>Synced folders</b></div>
      <div class="lib-list folder-list">${folderRows}</div>`,
  )
  wireRail()
  document.getElementById('back')!.onclick = back
  document.querySelectorAll<HTMLElement>('.view [data-dir]').forEach((el) => {
    el.onclick = () => invoke('open_folder', { path: el.dataset.dir })
  })
  fitTrayWindow()
}

// An open inline device-rename editor owns the Settings view: background
// repaint triggers (pending poll, update check, focus-regain) rebuild
// innerHTML and would silently wipe the draft mid-type, so paintSettings
// no-ops while it is set (plan 2026-07-08-002, U5 guard a).
let editingDeviceLabel = false

function paintSettings() {
  if (editingDeviceLabel) return
  const auth = trayAuthNow()
  const accountSub = auth.disconnected
    ? 'Disconnected'
    : auth.displayHandle != null
      ? `@${escapeHtml(auth.displayHandle)}`
      : auth.tier === 'linked'
        ? 'Signed in'
        : ''
  const accountBlock = auth.canSignOut
    ? `<div class="set-row set-account"><div class="set-account-col"><span class="nm">Account</span><span class="set-account-sub">${accountSub}</span></div><span class="spacer"></span><button type="button" class="set-action" id="settingslogout">Sign out</button></div>`
    : ''
  // Which device THIS machine is in the account's Connections list — so a
  // multi-machine user can tell the laptop from the studio Mac without guessing.
  // Renames inline: the tray IS the device, so its own name edits in place.
  const deviceLabel = trayAuth?.device_label ?? null
  const deviceNounTitle = deviceNoun().replace(/^this /, 'This ')
  const deviceBlock =
    auth.canSignOut && deviceLabel
      ? `<div class="set-row set-account"><div class="set-account-col" id="devicecol"><span class="nm">${escapeHtml(deviceNounTitle)}</span><span class="set-account-sub" id="devicelabel">${escapeHtml(deviceLabel)}</span></div><span class="spacer"></span><button type="button" class="set-action" id="setdevice">Rename</button></div>`
      : ''
  app.innerHTML = panelWithRail(
    'settings',
    `<div class="view-head"><b>Settings</b></div>
      <div class="set-body">
        ${accountBlock}
        ${deviceBlock}
        <div class="set-links">
          <button type="button" class="set-link" id="setweb"><span class="nm">Open web</span><span class="spacer"></span><span class="set-ext">${ICON.arrowUpRight}</span></button>
          <button type="button" class="set-link" id="setdocs"><span class="nm">Help &amp; docs</span><span class="spacer"></span><span class="set-ext">${ICON.arrowUpRight}</span></button>
        </div>
      </div>
      ${
        updateReadyVersion
          ? `<button type="button" class="update-ready-bar" id="update-relaunch"><span class="update-ready-dot"></span>${updateReadyVersion ? `Version ${escapeHtml(updateReadyVersion)} ready` : 'Update ready'}. Relaunch to install</button>`
          : updateStuckVersion !== null
            ? `<button type="button" class="update-ready-bar update-stuck-bar" id="update-stuck"><span class="update-ready-dot"></span>${updateStuckVersion ? `Version ${escapeHtml(updateStuckVersion)} could not install` : "This copy can't update itself"}. Download it instead</button>`
            : ''
      }
      <div class="set-foot">
        <span class="set-version" id="set-version">${appVersion ? `v${escapeHtml(appVersion)}` : ''}</span>
        <button type="button" class="set-foot-link set-quit" id="setquit">Quit</button>
      </div>`,
  )
  wireRail()
  document.getElementById('update-relaunch')?.addEventListener('click', () => void applyUpdateAndRelaunch())
  document.getElementById('update-stuck')?.addEventListener('click', () =>
    invoke('open_web', { path: '/install' }),
  )
  document.getElementById('settingslogout')?.addEventListener('click', () => void signOutFromTray())
  document.getElementById('setweb')?.addEventListener('click', () => invoke('open_web'))
  const openDeviceRename = () => {
    if (!deviceLabel || editingDeviceLabel) return
    startDeviceRename(deviceLabel, deviceNounTitle)
  }
  document.getElementById('setdevice')?.addEventListener('click', openDeviceRename)
  document.getElementById('devicelabel')?.addEventListener('click', openDeviceRename)
  document.getElementById('setdocs')?.addEventListener('click', () => invoke('open_web', { path: '/docs' }))
  document.getElementById('setquit')?.addEventListener('click', () => invoke('quit_app'))
  // Confirm the build-time version against the running app (no-op in the mock).
  getVersion()
    .then((v) => {
      appVersion = v
      const el = document.getElementById('set-version')
      if (el) el.textContent = `v${v}`
    })
    .catch(() => {})
  fitTrayWindow()
}

// Inline device rename (plan 2026-07-08-002, U5). Swaps the Settings row's
// label for an input. Guards: (a) paintSettings no-ops while editing (see
// editingDeviceLabel); (b) blur is ignored while a save is in flight, so the
// async result can still land its error into a live input; (c) unparseable
// sidecar output (an older PATH/SKILLET_BIN CLI without `device rename`)
// reads as "CLI out of date", never raw commander text.
function startDeviceRename(current: string, nounTitle: string): void {
  const col = document.getElementById('devicecol')
  if (!col) return
  editingDeviceLabel = true
  col.innerHTML = `<span class="nm">${escapeHtml(nounTitle)}</span><input id="devlabelinput" class="set-device-input" maxlength="80" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(current)}" /><span class="set-device-err" id="devlabelerr"></span>`
  const input = document.getElementById('devlabelinput') as HTMLInputElement | null
  if (!input) {
    editingDeviceLabel = false
    return
  }
  input.focus()
  input.select()
  let saving = false
  const finish = () => {
    editingDeviceLabel = false
    paintSettings()
  }
  const save = async () => {
    if (saving) return
    const label = normalizeDeviceLabel(input.value)
    // Empty = cancel (KTD5): a null save would vanish this row entirely.
    if (label === null || label === current) {
      finish()
      return
    }
    saving = true
    input.disabled = true
    try {
      const res = parseCliJson<{ ok: boolean; error?: string; label?: string | null }>(
        await invoke<string>('rename_device', { label }),
        'device rename',
      )
      if (!res.ok) throw new Error(res.error ?? 'Could not rename this device.')
      trayAuth = await getAuth()
      finish()
    } catch (e) {
      saving = false
      input.disabled = false
      const err = document.getElementById('devlabelerr')
      if (err) err.textContent = cleanCliError(String(e))
      input.focus()
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !saving) finish()
    else if (e.key === 'Enter') void save()
  })
  input.addEventListener('blur', () => {
    if (!saving) finish()
  })
}

// Record a new global paste shortcut: capture the next full key combo and persist
// it. Shared by any surface with a rebindable keycap; repaints via `after`.
// The current combo is unregistered while recording — a live global shortcut
// goes to the OS toggle handler, never the webview, so re-recording the same
// combo would just reopen the panel.
let cancelShortcutRebind: (() => void) | null = null
function startShortcutRebind(after: () => void): void {
  if (recording) return
  recording = true
  void invoke('suspend_shortcut').catch(() => {})
  after()
  const finish = () => {
    window.removeEventListener('keydown', onKey, true)
    cancelShortcutRebind = null
    recording = false
  }
  const onKey = async (e: KeyboardEvent) => {
    e.preventDefault()
    const accel = eventToAccel(e)
    if (!accel) return // ignore bare modifiers; wait for a full combo
    finish()
    try {
      trayShortcut = await invoke<string>('set_shortcut', { accel })
    } catch {
      // Keep the current shortcut, but bring its registration back.
      void invoke('resume_shortcut').catch(() => {})
    }
    after()
  }
  cancelShortcutRebind = () => {
    finish()
    void invoke('resume_shortcut').catch(() => {})
  }
  window.addEventListener('keydown', onKey, true)
}

// ── Silent auto-update ─────────────────────────────────────────────────────────
// Check on launch + on a timer, download in the background, then surface a quiet
// "relaunch to update" nudge in Settings. No dialogs, no forced restart — the
// update applies only when the user clicks relaunch.
async function maybeCheckForUpdate(): Promise<void> {
  if (pendingUpdate) return // already downloaded, waiting for relaunch
  if (!(await usingCli())) return // no native updater in the browser preview
  // Held outside the try so the catch can name the version we failed to reach:
  // `check()` usually succeeds and it's `download()` (signature verification)
  // that throws, so the version IS known even on the failure path.
  let offered: TauriUpdate | null = null
  try {
    const update = await check()
    if (!update?.available) return
    offered = update
    await update.download() // background download; do NOT install yet
    updateStuckVersion = null
    updateFailStreak = 0
    pendingUpdate = update
    updateReadyVersion = update.version
    // Light the passive cue live, from whatever rail-bearing view is open —
    // paintTray dispatches on trayView to the right per-view render, all of which
    // show the account-avatar dot (Settings additionally shows the relaunch bar).
    // Skip the signin gate: it has no rail (so no dot to light) and repainting it
    // would wipe a half-typed pair code. Don't paint over the hard update-block
    // screen either.
    if (!trayUpgradeRequired && trayView !== 'signin') paintTray(lastSkills, lastGranted)
  } catch {
    // A transient miss (offline, no published release, a dev endpoint 404) must
    // stay silent. A PERSISTENT one must not: a build whose updater pubkey no
    // longer matches the key signing releases fails verification on every run,
    // re-downloads the whole bundle every 6h, and — swallowed here — looked
    // exactly like being up to date. Surface a manual-install route once the
    // failure has repeated, since no future auto-update can fix that build.
    updateFailStreak += 1
    if (updateFailStreak >= UPDATE_FAIL_STREAK_BEFORE_NUDGE) {
      updateStuckVersion = offered?.version ?? updateStuckVersion ?? ''
      if (!trayUpgradeRequired && trayView !== 'signin') paintTray(lastSkills, lastGranted)
    }
  }
}

async function applyUpdateAndRelaunch(): Promise<void> {
  if (!pendingUpdate) return
  try {
    await pendingUpdate.install()
    await relaunch()
  } catch {
    // Install failed — leave the nudge so the user can retry.
  }
}

if (view === 'tray') {
  // Another window (onboarding) paired this machine: drop the stale gate,
  // refresh auth, and start syncing — same path as the gate's own success.
  void listen('skillet:paired', async () => {
    setTrayDisconnected(false)
    trayAuth = await getAuth()
    trayKit = null
    traySyncKits = null
    trayAdapters = null
    trayView = 'home'
    void renderTray()
    // No immediate runSync: the onboarding window owns the first sync (its
    // payoff screen needs the answer); the device sync stream pushes anything
    // added after that.
    void ensureDeviceSyncStream()
  })
  // Refresh when the tray regains focus (re-opened), but NOT when the focus was
  // caused by a click into the panel — repainting mid-click would swallow the tap
  // and force a second click. Skip the refresh if a pointerdown just happened.
  // Hold background repaints that would land mid-press (see paintTray).
  initTrayPressGuard()
  let lastPointerDown = 0
  window.addEventListener('pointerdown', () => (lastPointerDown = Date.now()), true)
  window.addEventListener('focus', () => {
    setTimeout(() => {
      if (Date.now() - lastPointerDown > 250) {
        void renderTray()
        void maybeSyncOnTrayOpen()
      }
    }, 40)
  })
  // The one dismiss path, shared by outside-click and Escape so both leave the
  // panel in the same state.
  const dismissTray = (): void => {
    // Hide through the backend, not getCurrentWindow().hide(): it stamps the
    // hide so the tray-icon toggle can tell this dismiss from a stale one.
    // Clicking the icon while open blurs (mouse down) before the toggle reads
    // visibility (mouse up), and without the stamp the toggle reopens the panel.
    void invoke('hide_tray')
      .catch(() => getCurrentWindow().hide())
      .then(() => {
        // Menubar norm: a dropdown reopens on its main view, not where it left
        // off. Reset + repaint only ONCE HIDDEN — hide() is async, and resetting
        // alongside it repaints the still-visible panel, so the jump back to
        // Latest flashes on screen before the window goes away.
        if (trayView !== 'home') {
          trayView = 'home'
          void renderTray()
        }
      })
  }
  window.addEventListener('blur', () => {
    // Close on outside-click on EVERY screen, like a normal menubar dropdown.
    // The only hold-open is live shortcut recording (a blur there is the key
    // capture, not an outside click).
    if (!recording) dismissTray()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    // Recording owns Escape outright — there it is a captured key, not a dismiss.
    if (recording) return
    // An inline editor (device rename) owns the FIRST Escape so it can cancel
    // itself; once focus is back out of the field, the next one closes the panel.
    const el = document.activeElement
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
    dismissTray()
  })
  // Opportunistic daily auto-sync: once on launch (throttled), then an hourly
  // staleness check that syncs at most ~once a day. No background daemon.
  void maybeAutoSync()
  void ensureDeviceSyncStream()
  setInterval(() => void maybeAutoSync(), 60 * 60 * 1000)
  // Cheap account-pending refresh so a web/desktop approval shows up promptly.
  setInterval(() => void refreshPending(), PENDING_POLL_MS)
  // Silent auto-update: check on launch, then every 6 hours.
  void maybeCheckForUpdate()
  setInterval(() => void maybeCheckForUpdate(), 6 * 60 * 60 * 1000)
}

// ── Onboarding (first run) ─────────────────────────────────────────────────────
async function renderOnboarding() {
  let step: 'welcome' | 'link' | 'sync' | 'permission' = 'welcome'
  let connecting = false
  let linkMsg = ''
  let shakeCode = false // one-shot: bad code shakes the boxes instead of lecturing
  let connectedHandle: string | null = null
  // paint() rebuilds innerHTML, which would wipe a half-typed code — carry it over.
  let codeDraft = ''
  let detecting = false
  let needsPerm = true
  let found: Adapter[] = []
  // Payoff: null until the first real sync answers; then the kit-skill count
  // that landed (max per-agent count — every agent receives the kit).
  let syncedTotal: number | null = null
  // Rows animate on their first appearance only; count merges repaint text
  // without replaying the stagger (same rule as the step-enter motion).
  let rowsAnimated = false
  // The welcome proves the promise instead of stating it: local detection of
  // the agents already on this machine, before any account exists.
  let welcomeAgents: Adapter[] | null = null
  // Step-enter motion fires only on actual step changes — an error repaint
  // must not replay the slide (Apple: motion carries meaning, not decoration).
  let lastPaintedStep: string | null = null
  let obShortcut = 'Alt+Shift+KeyS'

  void getDetectedAgents()
    .then((a) => {
      welcomeAgents = a
      if (step === 'welcome') paint()
    })
    .catch(() => {})

  void invoke<string>('get_shortcut')
    .then((s) => {
      obShortcut = s
      paint()
    })
    .catch(() => {})

  axGranted().then((g) => {
    needsPerm = !g
    paint()
  })

  async function paint() {
    const granted = step === 'permission' ? await axGranted() : false
    // The prompt is one-per-app. Once spent, "Allow access" would be a lie —
    // pressing it can only open System Settings from then on.
    const asked = step === 'permission' ? await axAsked() : false
    const noun = deviceNoun() // platform noun: Mac/PC/device, from platform-copy
    const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
    const dotSteps = needsPerm
      ? ['welcome', 'link', 'sync', 'permission']
      : ['welcome', 'link', 'sync']
    const dots = `<div class="dots">${dotSteps
      .map((s) => `<span class="${step === s ? 'on' : ''}"></span>`)
      .join('')}</div>`
    // One header per moment: welcome carries the promise; every later step
    // carries only its own job. Never a task list before a reason.
    const header =
      step === 'welcome'
        ? `<div class="ob-head" data-tauri-drag-region>${brandMark('ob-logo ob-brand')}<div class="ob-title">Skills worth running.</div><div class="ob-sub">Connect ${noun} and skills you add on Skillet land in your agents, instantly.</div></div>`
        : step === 'link'
          ? `<div class="ob-head" data-tauri-drag-region>${brandMark('ob-logo ob-brand ob-logo-sm')}<div class="ob-title">Connect ${noun}</div></div>`
          : step === 'sync'
            ? `<div class="ob-head" data-tauri-drag-region>${brandMark('ob-logo ob-brand ob-logo-sm')}<div class="ob-title">Connected${connectedHandle ? ` to @${escapeHtml(connectedHandle)}` : ''} <span class="ob-ok">✓</span></div><div class="ob-sub">${
              syncedTotal === null
                ? `Syncing your skills to ${noun}.`
                : syncedTotal > 0
                  ? `${syncedTotal} skill${syncedTotal === 1 ? '' : 's'} just landed in your agents.`
                  : 'Your agents are ready for their first skill.'
            }</div></div>`
            : `<div class="ob-head" data-tauri-drag-region>${brandMark('ob-logo ob-brand ob-logo-sm')}<div class="ob-title">One more thing</div></div>`
    let body = ''

    if (step === 'welcome') {
      // Detected agents lead as personal proof; a "+ more" chip absorbs any
      // detection miss (under a FOUND caption an omission reads as failure)
      // and carries the breadth pitch. Falls back to the flagship three.
      const detected = (welcomeAgents ?? [])
        // "Universal" is the shared dir, not an agent a person knows; the CLI
        // labels the codex row "Codex" when ~/.codex proves it's installed.
        .filter((a) => (a.label ?? pretty(a.name)) !== 'Universal')
        .map((a) => ({ name: a.name, label: a.label ?? pretty(a.name) }))
      // Always a 2×2: three agent pills (detected first, flagship fill) plus
      // a ghost "+ more" in the fourth slot — deterministic layout, no orphan
      // wrap, and honest under a works-with (not found-on) caption.
      const FLAGSHIP = [
        { name: 'claude-code', label: 'Claude Code' },
        { name: 'cursor', label: 'Cursor' },
        { name: 'codex', label: 'Codex' },
        { name: 'windsurf', label: 'Devin Desktop' },
      ]
      const shown = [...detected]
      for (const f of FLAGSHIP) {
        if (shown.length >= 3) break
        if (!shown.some((a) => a.label === f.label)) shown.push(f)
      }
      const chips =
        shown
          .slice(0, 3)
          .map(
            (a) => `<span class="ob-agent">${agentLogoSvg(a.name) ?? ''}${escapeHtml(a.label)}</span>`,
          )
          .join('') + `<span class="ob-agent ob-agent-more">+ more</span>`
      // No caption: the sub ends "…into your agents", and this row IS those
      // agents — proximity does the mapping (a label here would be the mapping
      // failing). Bare lockups, not pills: containers on non-interactive
      // content read as controls and steal weight from Get started.
      body = `<div class="ob-agents">${chips}</div>
        <button class="ob-cta" id="ob-start">Get started</button>
        <div class="ob-fine">Connecting never uploads your local skills.</div>`
    } else if (step === 'link') {
      body = `<div class="ob-note">Get your pair code at <button class="ob-link" id="ob-web">skillet.md/settings ↗</button></div>
        ${pairCodeBoxesHtml('ob-code-boxes')}
        <div class="ob-msg" id="ob-msg">${escapeHtml(linkMsg)}</div>
        <button class="ob-cta" id="ob-connect" disabled>${connecting ? 'Connecting…' : `Connect ${Noun}`}</button>
        <div class="ob-privacy">Connecting never uploads your local skills.</div>
        <div class="ob-fine">No account? Getting a code creates one.</div>`
    } else if (step === 'sync') {
      const detected = found.filter((a) => a.status !== 'skipped-not-detected')
      const rows = detecting
        ? `<div class="ob-row"><span class="todo">◌</span> Syncing to your runtimes…</div>`
        : detected.length
          ? detected
              .map((a, i) => {
                const mark = a.status === 'materialized' ? '✓' : a.status === 'failed' ? '!' : '○'
                const cls = a.status === 'materialized' ? 'done' : 'todo'
                const extra =
                  a.status === 'materialized' && a.count
                    ? ` · ${a.count} skill${a.count === 1 ? '' : 's'}`
                    : ''
                return `<div class="ob-row${rowsAnimated ? '' : ' ob-row-in'}" style="--i:${i}"><span class="${cls}">${mark}</span> ${escapeHtml(a.label ?? pretty(a.name))}${extra}</div>`
              })
              .join('')
          : `<div class="ob-row"><span class="todo">○</span> No agents detected yet</div>`
      // This step is only reachable after a successful connect (there is no
      // skip path — pairing is the front door), so the copy assumes linked.
      // Two payoffs: skills landed (counts, staggered arrival) or a fresh
      // account (convert straight to finding the first skill).
      const freshAccount = syncedTotal === 0 && !detecting
      if (!detecting && detected.length > 0) rowsAnimated = true
      body = `<div class="ob-card"><div class="ob-cap">${escapeHtml(`FOUND ON ${deviceNoun().replace(/^this /, 'THIS ').toUpperCase()}`)}</div>${rows}</div>
        ${
          freshAccount
            ? `<button class="ob-cta" id="ob-browse">Find your first skill</button>
               <div class="ob-fine">Add one from people you trust. It lands here in seconds.</div>
               <button class="ob-skip" id="cta">${needsPerm ? 'Continue' : 'Skip for now'}</button>`
            : `<button class="ob-cta" id="cta" ${detecting ? 'disabled' : ''}>${detecting ? 'Syncing…' : needsPerm ? 'Continue' : 'Open Skillet'}</button>`
        }`
    } else {
      const permNeeded = onboardingPermissionNeededBody(obShortcut)
      const permFine = onboardingPermissionFine(obShortcut)
      body = granted
        ? `<div class="ob-card center"><div class="ob-big" style="color:var(--success)">✓</div><b>You're all set</b><span class="ob-sub2">Press ${escapeHtml(prettyAccel(obShortcut))} in any app to drop a skill.</span></div><button class="ob-cta" id="done">Done</button>`
        : `<div class="ob-card center"><div class="ob-big" style="color:var(--accent)">⌨</div><b>Let Skillet paste for you</b><span class="ob-sub2">${escapeHtml(permNeeded)}</span></div><button class="ob-cta" id="allow">${escapeHtml(accessibilityActionLabel(asked))}</button><button class="ob-skip" id="skip">Skip for now</button><div class="ob-fine">${escapeHtml(permFine)}</div>`
    }

    const stepChanged = lastPaintedStep !== step
    lastPaintedStep = step
    app.innerHTML = `<div class="panel onboarding" data-tauri-drag-region><button class="ob-close" id="ob-close" aria-label="Close">×</button><div class="ob-step${stepChanged ? ' ob-enter' : ''}">${header}${body}</div>${dots}</div>`

    document
      .getElementById('ob-close')
      ?.addEventListener('click', () => void getCurrentWindow().close())

    // Drag anywhere on the panel that isn't an interactive control. The injected
    // data-tauri-drag-region handler fires only when the click target IS the
    // attributed element, which makes a content-filled panel effectively
    // undraggable — call the window API directly instead.
    app.querySelector('.panel')?.addEventListener('mousedown', (e) => {
      const me = e as MouseEvent
      if (me.button !== 0) return
      if ((me.target as HTMLElement).closest('button, input, a')) return
      me.preventDefault()
      void getCurrentWindow().startDragging()
    })

    document.getElementById('ob-start')?.addEventListener('click', () => {
      step = 'link'
      paint()
    })
    // /settings redirects through sign-in when logged out, so this one link
    // covers both "sign in" and "copy your pair code".
    document
      .getElementById('ob-web')
      ?.addEventListener('click', () => void invoke('open_web', { path: '/settings' }))
    const connectBtn = document.getElementById('ob-connect') as HTMLButtonElement | null
    // The button is honest: dead until the code is complete. Paste of a full
    // code still auto-connects via onSubmit. (Indirection via `getCode` ref:
    // onChange fires during wiring, before the getter is assigned.)
    let getCode: (() => string) | null = null
    const syncConnectEnabled = () => {
      if (connectBtn && !connecting) {
        connectBtn.disabled = (getCode?.() ?? '').replace(/[^A-Za-z0-9]/g, '').length !== PAIR_CODE_LEN
      }
    }
    if (step === 'link') {
      getCode = wirePairCodeBoxes(
        'ob-code-boxes',
        () => connectBtn?.click(),
        codeDraft,
        syncConnectEnabled,
      )
    }
    syncConnectEnabled()
    if (shakeCode) {
      shakeCode = false
      document.getElementById('ob-code-boxes')?.classList.add('shake')
    }
    connectBtn?.addEventListener('click', async () => {
      const raw = getCode?.() ?? ''
      codeDraft = raw
      const code = extractPairCode(raw)
      if (!code || connecting) return
      connecting = true
      linkMsg = ''
      paint()
      try {
        const res = parseCliJson<{ ok: boolean; error?: string; handle?: string | null }>(
          await invoke<string>('connect', { pairCode: code }),
          'connect',
        )
        if (res.ok) {
          connecting = false
          linkMsg = ''
          connectedHandle = res.handle ?? null
          // The tray is a separate webview with its own cached auth state —
          // without this it keeps showing the signed-out gate after pairing.
          void emit('skillet:paired')
          detecting = true
          step = 'sync'
          // FOUND list = pure local detection: a lock race or transient sync
          // failure must never render "nothing detected" seconds after the
          // welcome proved detection. The full sync merges counts when it lands.
          found = await getDetectedAgents()
          detecting = false
          paint()
          // A lock-raced or failed sync returns NO adapters at all; a real
          // answer always carries the adapter list (counts may be zero). Only
          // the latter may claim an outcome — retry briefly on the former so
          // the fresh-account conversion can never fire from a race.
          const settleSync = async (attempt = 0): Promise<void> => {
            const synced = await getAdapters()
            if (step !== 'sync') return
            if (synced.length > 0) {
              const byName = new Map(synced.map((a) => [a.name, a]))
              found = found.map((f) => (byName.has(f.name) ? { ...byName.get(f.name)!, label: f.label } : f))
              syncedTotal = Math.max(0, ...synced.map((a) => a.count ?? 0), 0)
              paint()
              return
            }
            if (attempt < 4) setTimeout(() => void settleSync(attempt + 1), 1500)
          }
          void settleSync()
        } else {
          connecting = false
          linkMsg = res.error ?? 'That code didn’t work. Grab a fresh one and try again.'
          shakeCode = true
          paint()
        }
      } catch (e) {
        connecting = false
        linkMsg = cleanCliError(String(e))
        shakeCode = true
        paint()
      }
    })
    document.getElementById('ob-browse')?.addEventListener('click', () => {
      void invoke('open_web', { path: '/browse' })
      if (!needsPerm) invoke('finish_onboarding')
      else {
        step = 'permission'
        paint()
      }
    })
    document.getElementById('cta')?.addEventListener('click', () => {
      if (needsPerm) {
        step = 'permission'
        paint()
      } else invoke('finish_onboarding')
    })
    document
      .getElementById('allow')
      ?.addEventListener('click', () => invoke('request_accessibility'))
    document.getElementById('skip')?.addEventListener('click', () => invoke('finish_onboarding'))
    document.getElementById('done')?.addEventListener('click', () => invoke('finish_onboarding'))
  }
  setInterval(() => {
    if (step === 'permission') paint()
  }, 1200)
  paint()
}

// ── Preview-only view switcher ──────────────────────────────────────────────────
// In the browser preview (no Tauri runtime) show a small bar to flip between the
// three windows without editing the URL. Never rendered inside the real app.
// Real Tauri window sizes (see tauri.conf.json). Tray height is content-driven.
const PREVIEW_SIZES: Record<string, { w: number; h: number | null }> = {
  tray: { w: 360, h: null },
  palette: { w: 560, h: 392 },
  onboarding: { w: 400, h: 560 },
}
function applyPreviewFrame() {
  if ('__TAURI_INTERNALS__' in window) return
  const size = PREVIEW_SIZES[view] ?? PREVIEW_SIZES.palette
  const style = document.createElement('style')
  style.textContent = `
    html { height: 100%; }
    body {
      margin: 0; min-height: 100vh; box-sizing: border-box;
      padding: 44px 0;
      background: radial-gradient(1100px 760px at 50% -8%, #2a2a2e, #161618) fixed;
      display: flex; align-items: flex-start; justify-content: center;
    }
    #app {
      width: ${size.w}px; ${size.h ? `height: ${size.h}px;` : ''}
      flex: 0 0 auto;
      border-radius: 14px; overflow: hidden;
      box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 0 0 0.5px rgba(255,255,255,.06);
    }
    #app .panel { height: 100%; }
  `
  document.head.appendChild(style)
}
applyPreviewFrame()

// Preview-only theme override. The app follows `prefers-color-scheme`; these
// class rules (higher specificity than the app's `:root` media query) let the
// preview force light or dark regardless of the system setting.
function currentPreviewTheme(): 'light' | 'dark' {
  const q = params.get('theme')
  if (q === 'light' || q === 'dark') return q
  try {
    const stored = localStorage.getItem('previewTheme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* private mode */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function applyPreviewTheme(theme: 'light' | 'dark') {
  if (!document.getElementById('preview-theme-vars')) {
    const style = document.createElement('style')
    style.id = 'preview-theme-vars'
    style.textContent = `
      html.preview-light { color-scheme: light; }
      html.preview-light {
        --accent: #2a2622; --accent-bg: #eae5da; --success: #12b76a; --caution: #f59e0b; --danger: #b42318;
        --ink: #1a1915; --ink-2: #646258; --ink-3: #9b978c;
        --bg: #fafaf8; --surface: #ffffff; --card-pop: #ffffff; --card-soft: #f0ece1; --line: #e6e4dd;
      }
      html.preview-dark { color-scheme: dark; }
      html.preview-dark {
        --accent: #ece6da; --accent-bg: #262019; --success: #6ce9a6; --caution: #fbbf24; --danger: #f97066;
        --ink: #edebe6; --ink-2: #9c9a92; --ink-3: #6f6d65;
        --bg: #0e0e0c; --surface: #161614; --card-pop: #1f1c18; --card-soft: #1c1a16; --line: #26251f;
      }`
    document.head.appendChild(style)
  }
  document.documentElement.classList.remove('preview-light', 'preview-dark')
  document.documentElement.classList.add(`preview-${theme}`)
}

function mountPreviewSwitcher() {
  if ('__TAURI_INTERNALS__' in window) return
  applyPreviewTheme(currentPreviewTheme())

  const views: Array<[string, string]> = [
    ['tray', 'Tray'],
    ['palette', 'Palette'],
    ['onboarding', 'Onboarding'],
    ['viewer', 'Viewer'],
  ]
  const bar = document.createElement('nav')
  bar.setAttribute('data-preview-switcher', '')
  bar.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:99999;display:flex;align-items:center;gap:2px;padding:3px;' +
    'border-radius:8px;background:rgba(20,20,22,.82);backdrop-filter:blur(8px);' +
    'font:600 11px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25)'
  for (const [v, label] of views) {
    const a = document.createElement('a')
    const url = new URL(location.href)
    url.searchParams.set('view', v)
    a.href = url.pathname + url.search
    a.textContent = label
    const active = v === view
    a.style.cssText =
      `padding:4px 9px;border-radius:6px;text-decoration:none;` +
      `color:${active ? '#fff' : 'rgba(255,255,255,.55)'};` +
      `background:${active ? 'rgba(255,255,255,.16)' : 'transparent'}`
    bar.appendChild(a)
  }

  // Divider + Light/Dark toggle (applies instantly, persists across view switches).
  const divider = document.createElement('span')
  divider.style.cssText = 'width:1px;height:16px;margin:0 3px;background:rgba(255,255,255,.18)'
  bar.appendChild(divider)

  const themes: Array<['light' | 'dark', string]> = [
    ['light', '☀'],
    ['dark', '☾'],
  ]
  const paint = () => {
    const cur = currentPreviewTheme()
    for (const btn of bar.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
      const on = btn.dataset.theme === cur
      btn.style.color = on ? '#fff' : 'rgba(255,255,255,.55)'
      btn.style.background = on ? 'rgba(255,255,255,.16)' : 'transparent'
    }
  }
  for (const [t, glyph] of themes) {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.theme = t
    b.textContent = glyph
    b.title = t === 'light' ? 'Light' : 'Dark'
    b.style.cssText =
      'padding:4px 8px;border:none;border-radius:6px;cursor:pointer;font:inherit;font-size:12px;background:transparent'
    b.onclick = () => {
      try {
        localStorage.setItem('previewTheme', t)
      } catch {
        /* private mode */
      }
      applyPreviewTheme(t)
      paint()
    }
    bar.appendChild(b)
  }
  document.body.appendChild(bar)
  paint()
}
mountPreviewSwitcher()

// The OS rounds the window itself, and that radius is not ours to pick: Windows
// 11 clips every top-level window at 8px. When the panel paints a 16px curve the
// two disagree and the filled surface shows outside the border stroke at each
// corner. Expose the platform so CSS can match the window's own radius.
document.documentElement.dataset.platform = devicePlatform()

// ── Router ─────────────────────────────────────────────────────────────────────
// Cover painting: covers render an instant SVG layer; this observer paints
// the shared canvas cover engine over them after every render, matching web.
installCoverPainting()
if (view === 'tray') {
  renderTray()
} else if (view === 'onboarding') renderOnboarding()
else if (view === 'viewer') {
  // The markdown viewer pulls in marked + dompurify — dynamically imported so
  // that weight only loads for its own window, never the tray/palette bundle.
  void import('./viewer').then((m) => m.renderViewer())
} else {
  initPaletteWindowListeners()
  void renderPaletteWindow()
}
