/**
 * The kit map, kept current by the app (plan U13; R20 R30, F5, KTD9 KTD10
 * KTD11). Everything goes through the bundled CLI, and nothing here holds a
 * path the scan found.
 *
 *  - The light check. Every 10 minutes and when the tray opens, the app
 *    compares the modification times of the folders the map scan reads
 *    (`map_watch_stamps`, metadata only, never a listing). Only when one moved
 *    does it run `skillet map --json` and compare the skills with the last
 *    scan it holds in memory. A new skill gets one tray line naming its job
 *    and how many skills that job holds now, so a job that just doubled up is
 *    a Merge away on the map.
 *  - The sync tick. Every sync starts with `skillet map --apply --json`, which
 *    makes the changes the account holds for this computer and claims
 *    device-less ones whose skills are here. While a Save holds this
 *    computer's lock the CLI answers `locked` at once, and the whole tick is
 *    skipped and tried again a minute later. Core decides what a live lock
 *    is; the app only reads the answer. A merge waiting to be written runs the
 *    person's AI tool for minutes, so the apply step only counts it: once the
 *    sync is done, the app starts `skillet map --apply` on its own to write
 *    it, under the same lock, so the ticks meanwhile skip as during a Save.
 */
import { ADAPTER_TABLE } from '@skillet/protocol/adapter-table'
import { isJobId, jobById, type JobId } from '@skillet/protocol/jobs'
import type { KitMapSaveCounts } from '@skillet/protocol/kit-map'
import { parseCliJson } from './cli-json'

/** How often the light check runs between tray opens. */
export const MAP_WATCH_INTERVAL_MS = 10 * 60 * 1000
/** How long a tick skipped for a live Save lock waits before it tries again. */
export const SAVE_LOCK_RETRY_MS = 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── What the light check stats ──────────────────────────────────────────────

/**
 * The folders and files the map scan reads (packages/core/src/map/scan.ts),
 * in tilde form. A skill added straight into a skills folder moves that
 * folder's time; installing or removing a plugin rewrites its tool's plugin
 * list. A path missing on this computer costs one stat.
 * packages/cli/tests/desktop-contract.test.ts holds this list to a real scan.
 */
export const MAP_WATCH_FIXED_PATHS: readonly string[] = Object.freeze([
  // Every tool's skills folder, from the adapter table.
  ...ADAPTER_TABLE.filter((entry) => entry.kind === 'global').map((entry) => entry.root),
  // Codex still loads its old folder, and the scan always reads it.
  '~/.codex/skills',
  // Where Devin and Hermes keep skills on Windows.
  '~/AppData/Roaming/devin/skills',
  '~/AppData/Local/hermes/skills',
  // The plugin lists of the tools with plugins.
  '~/.claude/plugins/installed_plugins.json',
  '~/.codex/config.toml',
])

/** A tool `skillet runtimes --json` detected, and where it keeps its skills. */
export interface WatchRuntime {
  name: string
  targetDir?: string
}

/** The folder above `path`, or null at a root. Either separator. */
function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut > 0 ? trimmed.slice(0, cut) : null
}

function joinLike(dir: string, ...parts: string[]): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return [dir.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

/**
 * Everything one check stats: the fixed list, plus each detected tool's
 * skills folder where the CLI resolved it (a Claude Code config folder set by
 * CLAUDE_CONFIG_DIR, a Hermes profile, Devin on Windows), plus Claude Code's
 * plugin list beside its folder, because the scan follows it there.
 */
export function mapWatchPaths(runtimes: readonly WatchRuntime[]): string[] {
  const paths = [...MAP_WATCH_FIXED_PATHS]
  const add = (path: string): void => {
    if (path.length > 0 && !paths.includes(path)) paths.push(path)
  }
  for (const runtime of runtimes) {
    if (!runtime.targetDir) continue
    add(runtime.targetDir)
    if (runtime.name === 'claude-code') {
      const claudeDir = parentOf(runtime.targetDir)
      if (claudeDir !== null) add(joinLike(claudeDir, 'plugins', 'installed_plugins.json'))
    }
  }
  return paths
}

// ── What a scan holds for the tray ──────────────────────────────────────────

/** One skill as the watch keeps it: only what a tray line needs. */
export interface MapSkill {
  key: string
  name: string
  /** Its job, or null for "Not sorted". */
  job: JobId | null
}

/**
 * `skillet map --json` as the watch keeps it. Read field by field, so a CLI
 * that adds fields never blanks the map; null when the output isn't a map at
 * all (an older CLI's help text, an error envelope).
 */
export function parseMapScan(raw: string): MapSkill[] | null {
  let parsed: unknown
  try {
    parsed = parseCliJson<unknown>(raw, 'map')
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.scan)) return null
  const entries = parsed.scan.entries
  if (!Array.isArray(entries)) return null
  const skills: MapSkill[] = []
  for (const item of entries) {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.name !== 'string') continue
    const job = typeof item.job === 'string' && isJobId(item.job) ? item.job : null
    skills.push({ key: item.key, name: item.name, job })
  }
  return skills
}

/** A skill the latest scan found that the one before didn't. */
export interface MapAddedSkill {
  key: string
  name: string
  job: JobId | null
  /** The job's name as the map shows it; null for "Not sorted". */
  jobName: string | null
  /** How many skills its job holds now, this one included. */
  count: number
  /** Its job now holds more than one and isn't one that holds many: the map marks it for Merge (R10). */
  doubled: boolean
}

/**
 * The skills in `after` that weren't in `before`. A changed key under a name
 * the last scan had is a skill edited in place, not a new one.
 */
export function addedSkills(before: readonly MapSkill[], after: readonly MapSkill[]): MapAddedSkill[] {
  const keys = new Set(before.map((s) => s.key))
  const names = new Set(before.map((s) => s.name.toLowerCase()))
  const counts = new Map<JobId | null, number>()
  for (const s of after) counts.set(s.job, (counts.get(s.job) ?? 0) + 1)
  const added: MapAddedSkill[] = []
  for (const s of after) {
    const name = s.name.toLowerCase()
    if (keys.has(s.key) || names.has(name)) continue
    names.add(name)
    const job = s.job === null ? undefined : jobById(s.job)
    const count = counts.get(s.job) ?? 1
    added.push({
      key: s.key,
      name: s.name,
      job: s.job,
      jobName: job?.name ?? null,
      count,
      doubled: job !== undefined && !job.many && count > 1,
    })
  }
  return added
}

/** How many found skills the tray keeps; three show, the rest fold into one line. */
const ADDED_KEEP = 50

/**
 * The skills the tray shows, with newly found ones first, each once. Callers
 * that joined one running check all get its result. The same array comes
 * back when nothing is new, so the tray can skip the repaint.
 */
export function withAdded(
  shown: readonly MapAddedSkill[],
  added: readonly MapAddedSkill[],
): readonly MapAddedSkill[] {
  const keys = new Set(shown.map((s) => s.key))
  const fresh = added.filter((s) => !keys.has(s.key))
  return fresh.length === 0 ? shown : [...fresh, ...shown].slice(0, ADDED_KEEP)
}

/** One tray line. */
export interface MapLine {
  title: string
  detail: string
}

const LINES_MAX = 3

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** One line per new skill, naming its job and the job's count. Past three, the rest fold into one line. */
export function mapLines(added: readonly MapAddedSkill[]): MapLine[] {
  const line = (s: MapAddedSkill): MapLine => ({
    title: s.name,
    detail: s.jobName === null ? 'Not sorted yet' : `${s.jobName} has ${plural(s.count, 'skill')} now`,
  })
  if (added.length <= LINES_MAX) return added.map(line)
  const shown = added.slice(0, LINES_MAX - 1).map(line)
  return [
    ...shown,
    { title: `${added.length - shown.length} more new skills`, detail: 'Each one is in its job on your map' },
  ]
}

// ── The light check ─────────────────────────────────────────────────────────

export interface MapWatchDeps {
  /** What to stat right now. */
  paths(): readonly string[]
  /** One stamp per path, null when it's missing (Tauri `map_watch_stamps`). */
  stamps(paths: readonly string[]): Promise<readonly (string | null)[]>
  /** `skillet map --json` (Tauri `map_scan`). */
  scan(): Promise<string>
}

export type MapCheck = { rescanned: false } | { rescanned: true; added: MapAddedSkill[] }

export interface MapWatch {
  /** Rescan when a watched path moved since the last good scan, or always with `force`. */
  check(opts?: { force?: boolean }): Promise<MapCheck>
  /** The last good scan's skills; null before the first. */
  skills(): readonly MapSkill[] | null
}

/**
 * The light check (KTD11). The first check scans to set the baseline and
 * names nothing. A scan that fails keeps the last map and leaves the stamps
 * unrecorded, so the next check tries again. Checks never overlap: a forced
 * one waits for the one running, then scans.
 */
export function createMapWatch(deps: MapWatchDeps): MapWatch {
  let lastStamp: string | null = null
  let last: MapSkill[] | null = null
  let running: Promise<MapCheck> | null = null
  let generation = 0

  const once = async (force: boolean): Promise<MapCheck> => {
    try {
      const paths = [...deps.paths()]
      let stamp: string | null
      try {
        const stamps = await deps.stamps(paths)
        stamp = JSON.stringify(paths.map((path, i) => [path, stamps[i] ?? null]))
      } catch {
        stamp = null
      }
      if (!force && last !== null && (stamp === null || stamp === lastStamp)) return { rescanned: false }
      const next = parseMapScan(await deps.scan())
      if (next === null) return { rescanned: false }
      const added = last === null ? [] : addedSkills(last, next)
      last = next
      lastStamp = stamp
      return { rescanned: true, added }
    } catch {
      return { rescanned: false }
    }
  }

  return {
    check(opts = {}) {
      const force = opts.force === true
      if (running !== null && !force) return running
      const prior = running
      const mine = ++generation
      running = (async () => {
        if (prior !== null) await prior
        try {
          return await once(force)
        } finally {
          if (generation === mine) running = null
        }
      })()
      return running
    },
    skills: () => last,
  }
}

// ── The sync tick ───────────────────────────────────────────────────────────

export type MapApplyOutcome =
  /** A Save holds this computer's lock: the whole tick waits (KTD10). */
  | { kind: 'locked' }
  /** No device token: the tick runs as it always has, and sync says why. */
  | { kind: 'not-connected' }
  /** `counts` what the run did and `left` what it left, Save's own counts. */
  | { kind: 'done'; result: 'applied' | 'partial' | 'failed'; changed: boolean; counts: KitMapSaveCounts; left: KitMapSaveCounts }
  /** Nothing the app can read: an older CLI with no `map`, or a sidecar that didn't start. */
  | { kind: 'unavailable' }

/** Read leniently: anything that isn't a positive number counts as none. */
function countsOf(value: unknown): KitMapSaveCounts {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const c = isRecord(value) ? value : {}
  return { backups: n(c.backups), removals: n(c.removals), fills: n(c.fills), merges: n(c.merges) }
}

/** Read `skillet map --apply --json`. Fields this app doesn't know are ignored. */
export function parseMapApply(raw: string): MapApplyOutcome {
  let parsed: unknown
  try {
    parsed = parseCliJson<unknown>(raw, 'map --apply')
  } catch {
    return { kind: 'unavailable' }
  }
  if (!isRecord(parsed)) return { kind: 'unavailable' }
  if (parsed.code === 'locked') return { kind: 'locked' }
  if (parsed.code === 'auth_required') return { kind: 'not-connected' }
  const data = parsed.data
  if (!isRecord(data)) return { kind: 'unavailable' }
  const result = data.result
  if (result !== 'applied' && result !== 'partial' && result !== 'failed') return { kind: 'unavailable' }
  const counts = countsOf(data.counts)
  return {
    kind: 'done',
    result,
    // A CLI from before `changed` was printed: anything it made counts.
    changed: data.changed === true || (data.changed === undefined && (counts.removals > 0 || counts.fills > 0)),
    counts,
    left: countsOf(data.left),
  }
}

export interface SyncTickDeps<T> {
  /** `skillet map --apply --json` (Tauri `map_apply`). */
  applyMap(): Promise<string>
  /** The rest of the tick: `skillet sync --json`, as before. */
  sync(): Promise<T>
  /** Try the whole tick again after this long, because a Save held the lock. */
  retryLater(ms: number): void
  /** The apply step changed this computer: bring the map up to date. Runs after the sync. */
  mapChanged(): unknown
  /** The apply step left merges waiting: start `skillet map --apply` to write them (Tauri `map_write_merges`). Runs after the sync. */
  writeMerges(): unknown
}

export type SyncTick<T> = { kind: 'locked' } | { kind: 'synced'; value: T; apply: MapApplyOutcome }

/**
 * One sync tick (KTD10): the map's waiting changes first, then the sync, then
 * the merges the first step left waiting, written by a run of their own. A
 * live Save lock skips the whole tick and asks for a retry. Any answer the
 * app can't read lets the sync run as it always has, so an older bundled CLI
 * never wedges sync; kinds of change it doesn't know stay waiting in the
 * account for a newer one.
 */
export async function runSyncTick<T>(deps: SyncTickDeps<T>): Promise<SyncTick<T>> {
  let apply: MapApplyOutcome
  try {
    apply = parseMapApply(await deps.applyMap())
  } catch {
    apply = { kind: 'unavailable' }
  }
  if (apply.kind === 'locked') {
    deps.retryLater(SAVE_LOCK_RETRY_MS)
    return { kind: 'locked' }
  }
  const value = await deps.sync()
  if (apply.kind === 'done' && apply.changed) await deps.mapChanged()
  if (apply.kind === 'done' && apply.left.merges > 0) {
    try {
      await deps.writeMerges()
    } catch {
      // Not started: the next tick counts the merges again.
    }
  }
  return { kind: 'synced', value, apply }
}
