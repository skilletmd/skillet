/**
 * The app's side of the kit map (plan U13; R20 R30, F5, KTD9 KTD10 KTD11).
 *
 * Every CLI answer here is mocked JSON in the shapes `skillet map --json` and
 * `skillet map --apply --json` print. Core's own behavior (the trash, the
 * acknowledgements, the allowlist) is tested in core; these tests hold the
 * app's orchestration: when it rescans, what it tells the person, and when it
 * skips a sync tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAP_WATCH_FIXED_PATHS,
  MAP_WATCH_INTERVAL_MS,
  SAVE_LOCK_RETRY_MS,
  addedSkills,
  createMapWatch,
  mapLines,
  mapWatchPaths,
  parseMapApply,
  parseMapScan,
  runSyncTick,
  withAdded,
  type MapAddedSkill,
  type MapSkill,
  type MapWatch,
} from './map-watch'
import { clearPersistedDeviceSyncSeq, startDeviceSyncStream } from './device-sync-stream'

// ── Fake CLI output ─────────────────────────────────────────────────────────

function hash(n: number): string {
  return `sha256:${n.toString(16).padStart(64, '0')}`
}

interface FakeSkill {
  key: string
  name: string
  job: string | null
  /** Where the fresh scan finds it: in a skills folder Skillet manages, or only outside one. */
  outside?: boolean
}

function skill(n: number, name: string, job: string | null, extra: Partial<FakeSkill> = {}): FakeSkill {
  return { key: hash(n), name, job, ...extra }
}

/** `skillet map --json`: the scan the frame draws, no path anywhere. */
function scanJson(skills: readonly FakeSkill[]): string {
  const entries = skills.map((s) => ({
    key: s.key,
    name: s.name,
    description: `${s.name}, a test skill`,
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job: s.job,
    usage: { state: 'unknown', reason: 'no-history' },
  }))
  return JSON.stringify({ ok: true, scan: { entries, looked: [], unchecked: [] } }, null, 2) + '\n'
}

const ZERO = { backups: 0, removals: 0, fills: 0, merges: 0 }

const LOCKED = JSON.stringify(
  { ok: false, error: 'Another Save is still running on this machine.', code: 'locked' },
  null,
  2,
)

const AUTH_REQUIRED = JSON.stringify(
  {
    ok: false,
    error: 'auth_required',
    code: 'auth_required',
    message: 'This machine is not paired to an account.',
  },
  null,
  2,
)

type PendingChange =
  | { id: string; kind: 'remove'; key: string; device: boolean }
  | { id: string; kind: 'replace'; job: string; keys: string[]; merged: FakeSkill; device: boolean }
  | { id: string; kind: string; device: boolean }

/**
 * One computer and its account, as the CLI reports them. `applyMap` answers
 * the way `skillet map --apply --json` does: a live lock answers `locked`, an
 * unconnected computer gets the auth envelope, and otherwise the waiting
 * changes this computer can make are made and acknowledged while the rest
 * stay waiting.
 */
class FakeComputer {
  skills: FakeSkill[]
  pending: PendingChange[] = []
  acked: Array<{ id: string; outcome: string }> = []
  connected = true
  locked = false
  folders = 1
  /** Merges waiting for this computer: the apply step counts them in `left` and writes none. */
  mergesWaiting = 0
  calls: string[] = []

  constructor(skills: FakeSkill[]) {
    this.skills = [...skills]
  }

  addSkill(s: FakeSkill): void {
    this.skills.push(s)
    this.folders++
  }

  stamps = vi.fn(async (paths: readonly string[]) => {
    this.calls.push('map_watch_stamps')
    return paths.map((p) => `${p}@${this.folders}`)
  })

  scan = vi.fn(async () => {
    this.calls.push('map_scan')
    return scanJson(this.skills)
  })

  applyMap = vi.fn(async () => {
    this.calls.push('map_apply')
    if (this.locked) return LOCKED
    if (!this.connected) return AUTH_REQUIRED
    const counts = { ...ZERO }
    const unremoved: Array<{ name: string; reason: string }> = []
    let changed = false
    const held = new Set(this.skills.map((s) => s.key))
    // Device-less changes (a dropped-folder Save) whose hashes this computer holds become its own.
    for (const change of this.pending) {
      if (change.device) continue
      if (change.kind === 'remove' && 'key' in change && held.has(change.key)) {
        change.device = true
        changed = true
      }
    }
    for (const change of [...this.pending]) {
      if (!change.device) continue
      if (change.kind === 'remove' && 'key' in change) {
        const found = this.skills.find((s) => s.key === change.key)
        if (found === undefined) {
          this.ack(change.id, 'gone')
        } else if (found.outside) {
          unremoved.push({ name: found.name, reason: 'outside-allowlist' })
          this.ack(change.id, 'not-removable')
        } else {
          this.skills = this.skills.filter((s) => s.key !== change.key)
          this.folders++
          counts.removals++
          changed = true
          this.ack(change.id, 'applied')
        }
      } else if (change.kind === 'replace' && 'merged' in change) {
        this.skills = this.skills.filter((s) => !change.keys.includes(s.key))
        this.skills.push(change.merged)
        this.folders++
        changed = true
        this.ack(change.id, 'applied')
      }
      // Any other kind is for a newer client: it stays waiting.
    }
    const data = {
      result: 'applied',
      counts,
      left: { ...ZERO, merges: this.mergesWaiting },
      not_backed_up: [],
      kept: [],
      unremoved,
      refused: [],
      trash_run: counts.removals > 0 ? '2026-11-16T21-00-00Z' : null,
      changed,
    }
    return JSON.stringify({ ok: true, data }, null, 2) + '\n'
  })

  private ack(id: string, outcome: string): void {
    this.acked.push({ id, outcome })
    this.pending = this.pending.filter((c) => c.id !== id)
  }
}

function watchOn(computer: FakeComputer): MapWatch {
  return createMapWatch({
    paths: () => ['~/.claude/skills', '~/.agents/skills'],
    stamps: computer.stamps,
    scan: computer.scan,
  })
}

/** The sync tick as the tray wires it: the map rescans when the apply step changed this computer. */
function tickDeps(computer: FakeComputer, watch: MapWatch) {
  return {
    applyMap: computer.applyMap,
    sync: vi.fn(async () => {
      computer.calls.push('sync_skills')
      return 'synced'
    }),
    retryLater: vi.fn(),
    mapChanged: vi.fn(async () => {
      await watch.check({ force: true })
    }),
    writeMerges: vi.fn(async () => {
      computer.calls.push('map_write_merges')
    }),
  }
}

const keysOf = (watch: MapWatch): string[] => (watch.skills() ?? []).map((s) => s.key)

// ── The watch list ──────────────────────────────────────────────────────────

describe('the watch list', () => {
  it('stats every tool folder the scan reads, plus each detected tool where it really keeps its skills', () => {
    for (const path of [
      '~/.claude/skills',
      '~/.agents/skills',
      '~/.codex/skills',
      '~/.claude/plugins/installed_plugins.json',
      '~/.codex/config.toml',
    ]) {
      expect(MAP_WATCH_FIXED_PATHS).toContain(path)
    }
    const paths = mapWatchPaths([
      { name: 'claude-code', targetDir: '/Users/test-machine/work-claude/skills' },
      { name: 'codex', targetDir: '/Users/test-machine/.agents/skills' },
      { name: 'hermes', targetDir: '/Users/test-machine/.hermes/profiles/work/skills' },
    ])
    expect(paths).toContain('/Users/test-machine/work-claude/skills')
    // Claude Code keeps plugins beside its skills folder, so the scan follows it there.
    expect(paths).toContain('/Users/test-machine/work-claude/plugins/installed_plugins.json')
    expect(paths).toContain('/Users/test-machine/.hermes/profiles/work/skills')
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('checks every ten minutes', () => {
    expect(MAP_WATCH_INTERVAL_MS).toBe(10 * 60 * 1000)
  })
})

// ── The light check ─────────────────────────────────────────────────────────

describe('the light check (R30, F5)', () => {
  it('sets its baseline on the first check and names nothing', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    const watch = watchOn(computer)
    expect(await watch.check()).toEqual({ rescanned: true, added: [] })
    expect(keysOf(watch)).toEqual([hash(1)])
  })

  it('no folder change means no rescan', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    const watch = watchOn(computer)
    await watch.check()
    expect(await watch.check()).toEqual({ rescanned: false })
    expect(await watch.check()).toEqual({ rescanned: false })
    expect(computer.scan).toHaveBeenCalledTimes(1)
    expect(computer.stamps).toHaveBeenCalledTimes(3)
  })

  it('a new skill folder between two checks gives one tray line naming its job and its count', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing'), skill(2, 'cold-email', 'sales.cold-outreach')])
    const watch = watchOn(computer)
    await watch.check()
    computer.addSkill(skill(3, 'copy-editor', 'writing.editing'))

    const result = await watch.check()
    expect(result.rescanned).toBe(true)
    const added = result.rescanned ? result.added : []
    expect(added).toEqual([
      { key: hash(3), name: 'copy-editor', job: 'writing.editing', jobName: 'Editing', count: 2, doubled: true },
    ])
    const lines = mapLines(added)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.title).toBe('copy-editor')
    expect(lines[0]!.detail).toContain('Editing')
    expect(lines[0]!.detail).toContain('2 skills')
    expect(computer.scan).toHaveBeenCalledTimes(2)
  })

  it('a skill edited in place is not a new skill', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    const watch = watchOn(computer)
    await watch.check()
    computer.skills = [skill(9, 'plain-prose', 'writing.editing')]
    computer.folders++
    expect(await watch.check()).toEqual({ rescanned: true, added: [] })
  })

  it('names Not sorted, and never marks a job that holds many as doubled', () => {
    const before: MapSkill[] = [{ key: hash(1), name: 'vercel', job: 'development.platforms' }]
    const after: MapSkill[] = [
      ...before,
      { key: hash(2), name: 'fly-io', job: 'development.platforms' },
      { key: hash(3), name: 'odd-one', job: null },
    ]
    const added = addedSkills(before, after)
    expect(added).toEqual([
      { key: hash(2), name: 'fly-io', job: 'development.platforms', jobName: 'Platforms', count: 2, doubled: false },
      { key: hash(3), name: 'odd-one', job: null, jobName: null, count: 1, doubled: false },
    ])
    expect(mapLines(added)[1]!.detail).toMatch(/not sorted/i)
  })

  it('a plugin that lands many skills at once folds into a short list', () => {
    const many = Array.from({ length: 36 }, (_, i) => ({
      key: hash(100 + i),
      name: `every-${i}`,
      job: null,
      jobName: null,
      count: 1,
      doubled: false,
    }))
    const lines = mapLines(many)
    expect(lines).toHaveLength(3)
    expect(lines[2]!.title).toMatch(/34 more/)
  })

  it('a failed scan keeps the last map and tries again on the next check', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    const watch = watchOn(computer)
    await watch.check()
    computer.addSkill(skill(2, 'copy-editor', 'writing.editing'))
    computer.scan.mockRejectedValueOnce(new Error("error: unknown command 'map'"))
    expect(await watch.check()).toEqual({ rescanned: false })
    expect(keysOf(watch)).toEqual([hash(1)])
    const again = await watch.check()
    expect(again.rescanned && again.added.map((a) => a.name)).toEqual(['copy-editor'])
  })

  it('callers that join one running check add each new skill once', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    const watch = watchOn(computer)
    await watch.check()
    computer.addSkill(skill(2, 'copy-editor', 'writing.editing'))
    // The tray opening and the ten-minute check land together.
    const results = await Promise.all([watch.check(), watch.check()])
    expect(computer.scan).toHaveBeenCalledTimes(2)
    let shown: readonly MapAddedSkill[] = []
    for (const result of results) if (result.rescanned) shown = withAdded(shown, result.added)
    expect(shown.map((s) => s.name)).toEqual(['copy-editor'])
    expect(withAdded(shown, [])).toBe(shown)
  })

  it('reads the scan leniently and never needs a path', () => {
    const raw = 'Scanning…\n' + scanJson([skill(1, 'plain-prose', 'writing.editing'), skill(2, 'odd', 'not.a-job')])
    expect(parseMapScan(raw)).toEqual([
      { key: hash(1), name: 'plain-prose', job: 'writing.editing' },
      { key: hash(2), name: 'odd', job: null },
    ])
    expect(parseMapScan('Usage: skillet [options] [command]')).toBe(null)
    expect(parseMapScan(JSON.stringify({ ok: false, error: 'boom' }))).toBe(null)
  })
})

// ── The sync tick ───────────────────────────────────────────────────────────

describe('the sync tick (KTD9, KTD10)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a pending remove trashes the matching local copies and is acknowledged; one whose hash isn\'t on this computer is left alone', async () => {
    const computer = new FakeComputer([skill(1, 'old-notes', 'business.meetings'), skill(2, 'plain-prose', 'writing.editing')])
    computer.pending = [
      { id: 'c1', kind: 'remove', key: hash(1), device: true },
      { id: 'c2', kind: 'remove', key: hash(7), device: true },
    ]
    const watch = watchOn(computer)
    await watch.check()
    const deps = tickDeps(computer, watch)

    const tick = await runSyncTick(deps)
    expect(tick.kind).toBe('synced')
    expect(tick.kind === 'synced' && tick.apply).toMatchObject({ kind: 'done', result: 'applied', changed: true, counts: { removals: 1 } })
    // The apply step runs first, then the sync, then the map catches up.
    expect(computer.calls.slice(2)).toEqual(['map_apply', 'sync_skills', 'map_watch_stamps', 'map_scan'])
    expect(computer.acked).toEqual([
      { id: 'c1', outcome: 'applied' },
      { id: 'c2', outcome: 'gone' },
    ])
    expect(keysOf(watch)).toEqual([hash(2)])
    expect(computer.skills.map((s) => s.name)).toEqual(['plain-prose'])
    expect(deps.retryLater).not.toHaveBeenCalled()
  })

  it('a live save lock makes the app skip its whole sync tick, and the first tick after the lock clears applies the pending changes', async () => {
    vi.useFakeTimers()
    const computer = new FakeComputer([skill(1, 'old-notes', 'business.meetings')])
    computer.pending = [{ id: 'c1', kind: 'remove', key: hash(1), device: true }]
    computer.locked = true
    const watch = watchOn(computer)
    const deps = tickDeps(computer, watch)
    const retried: { tick?: Promise<unknown> } = {}
    deps.retryLater.mockImplementation((ms: number) => {
      setTimeout(() => {
        retried.tick = runSyncTick(deps)
      }, ms)
    })

    expect(await runSyncTick(deps)).toEqual({ kind: 'locked' })
    expect(deps.sync).not.toHaveBeenCalled()
    expect(deps.mapChanged).not.toHaveBeenCalled()
    expect(deps.retryLater).toHaveBeenCalledWith(SAVE_LOCK_RETRY_MS)
    expect(computer.pending).toHaveLength(1)

    // The Save finishes and releases its lock before the retry comes round.
    computer.locked = false
    await vi.advanceTimersByTimeAsync(SAVE_LOCK_RETRY_MS - 1)
    expect(retried.tick).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(retried.tick).toBeDefined()
    const second = await retried.tick
    expect(second).toMatchObject({ kind: 'synced', apply: { kind: 'done', changed: true } })
    expect(deps.sync).toHaveBeenCalledTimes(1)
    expect(computer.pending).toHaveLength(0)
    expect(computer.skills).toHaveLength(0)
  })

  it('a device-sync wake after "Use merged" on skillet.md applies the replace without waiting for the daily sync', async () => {
    clearPersistedDeviceSyncSeq()
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing'), skill(2, 'copy-editor', 'writing.editing')])
    const watch = watchOn(computer)
    await watch.check()
    const deps = tickDeps(computer, watch)

    // The stream's first event is its baseline; "Use merged" writes a replace
    // and bumps the cursor, which wakes this app. No clock is involved: the
    // daily sync is nowhere near due.
    const encoder = new TextEncoder()
    const feed: { controller?: ReadableStreamDefaultController<Uint8Array>; tick?: Promise<unknown> } = {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        feed.controller = controller
        controller.enqueue(encoder.encode('data: {"type":"sync_required","seq":1}\n\n'))
      },
    })
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }))
    const stream = startDeviceSyncStream({
      config: { registryUrl: 'http://127.0.0.1:1', deviceToken: 'sk_dev_test' },
      fetchImpl,
      onSyncRequired: async () => {
        feed.tick = runSyncTick(deps)
        await feed.tick
      },
    })
    try {
      await vi.waitFor(() => expect(localStorage.getItem('deviceSyncLastSeq')).toBe('1'))
      expect(computer.applyMap).not.toHaveBeenCalled()

      computer.pending.push({
        id: 'r1',
        kind: 'replace',
        job: 'writing.editing',
        keys: [hash(1), hash(2)],
        merged: skill(3, 'editing-merged', 'writing.editing'),
        device: true,
      })
      feed.controller!.enqueue(encoder.encode('data: {"type":"sync_required","seq":2}\n\n'))
      await vi.waitFor(() => expect(feed.tick).toBeDefined())
      await feed.tick
      expect(computer.applyMap).toHaveBeenCalledTimes(1)
      expect(deps.sync).toHaveBeenCalledTimes(1)
      expect(computer.acked).toEqual([{ id: 'r1', outcome: 'applied' }])
      expect(keysOf(watch)).toEqual([hash(3)])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      stream.stop()
      feed.controller?.close()
      clearPersistedDeviceSyncSeq()
    }
  })

  it('a device-less remove from a dropped-folder Save reaches the first computer that installs the app', async () => {
    const computer = new FakeComputer([skill(1, 'old-notes', 'business.meetings'), skill(2, 'plain-prose', 'writing.editing')])
    computer.connected = false
    computer.pending = [{ id: 'd1', kind: 'remove', key: hash(1), device: false }]
    const watch = watchOn(computer)
    await watch.check()
    const deps = tickDeps(computer, watch)

    // Before this computer connects, the tick runs as it always has.
    const before = await runSyncTick(deps)
    expect(before).toMatchObject({ kind: 'synced', apply: { kind: 'not-connected' } })
    expect(computer.pending).toHaveLength(1)

    // The map's Save connected it: the first tick claims the change and makes it.
    computer.connected = true
    const first = await runSyncTick(deps)
    expect(first).toMatchObject({ kind: 'synced', apply: { kind: 'done', changed: true, counts: { removals: 1 } } })
    expect(computer.acked).toEqual([{ id: 'd1', outcome: 'applied' }])
    expect(keysOf(watch)).toEqual([hash(2)])
  })

  it('a pending change of an unknown kind is left in place', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    computer.pending = [{ id: 'u1', kind: 'rename-v9', device: true }]
    const watch = watchOn(computer)
    const deps = tickDeps(computer, watch)

    const tick = await runSyncTick(deps)
    expect(tick).toMatchObject({ kind: 'synced', apply: { kind: 'done', result: 'applied', changed: false } })
    expect(computer.pending).toEqual([{ id: 'u1', kind: 'rename-v9', device: true }])
    expect(deps.sync).toHaveBeenCalledTimes(1)
    expect(deps.mapChanged).not.toHaveBeenCalled()
    expect(deps.retryLater).not.toHaveBeenCalled()
  })

  it('a pending remove for a hash the fresh scan finds only outside the allowlist changes nothing', async () => {
    const computer = new FakeComputer([skill(1, 'pinned-elsewhere', 'writing.docs', { outside: true })])
    computer.pending = [{ id: 'o1', kind: 'remove', key: hash(1), device: true }]
    const watch = watchOn(computer)
    await watch.check()
    const deps = tickDeps(computer, watch)

    const tick = await runSyncTick(deps)
    expect(tick).toMatchObject({ kind: 'synced', apply: { kind: 'done', changed: false, counts: { removals: 0 } } })
    expect(computer.skills.map((s) => s.key)).toEqual([hash(1)])
    expect(deps.mapChanged).not.toHaveBeenCalled()
    expect(keysOf(watch)).toEqual([hash(1)])
  })

  it('a merge the apply step leaves waiting is written after the sync, by a `skillet map --apply` the app starts on its own', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing'), skill(2, 'copy-editor', 'writing.editing')])
    computer.mergesWaiting = 1
    const watch = watchOn(computer)
    const deps = tickDeps(computer, watch)

    const tick = await runSyncTick(deps)
    expect(tick).toMatchObject({ kind: 'synced', apply: { kind: 'done', result: 'applied', left: { merges: 1 } } })
    // The sync never waits on the AI tool: the merge run starts once the sync is done.
    expect(computer.calls).toEqual(['map_apply', 'sync_skills', 'map_write_merges'])

    // That run holds the save lock while it writes, so the next tick skips as during a Save.
    computer.locked = true
    expect(await runSyncTick(deps)).toEqual({ kind: 'locked' })
    // Written: nothing waits, and no run starts.
    computer.locked = false
    computer.mergesWaiting = 0
    await runSyncTick(deps)
    expect(deps.writeMerges).toHaveBeenCalledTimes(1)
    expect(deps.sync).toHaveBeenCalledTimes(2)
  })

  it('a merge run that would not start leaves the tick synced', async () => {
    const computer = new FakeComputer([skill(1, 'plain-prose', 'writing.editing')])
    computer.mergesWaiting = 2
    const watch = watchOn(computer)
    const deps = tickDeps(computer, watch)
    deps.writeMerges.mockRejectedValueOnce(new Error('skillet CLI not found'))
    expect(await runSyncTick(deps)).toMatchObject({ kind: 'synced', value: 'synced' })
  })

  it('an older CLI with no map command never wedges the tick', async () => {
    const sync = vi.fn(async () => 'synced')
    const retryLater = vi.fn()
    const tick = await runSyncTick({
      applyMap: async () => {
        throw new Error("error: unknown command 'map'")
      },
      sync,
      retryLater,
      mapChanged: vi.fn(),
      writeMerges: vi.fn(),
    })
    expect(tick).toEqual({ kind: 'synced', value: 'synced', apply: { kind: 'unavailable' } })
    expect(sync).toHaveBeenCalledTimes(1)
    expect(retryLater).not.toHaveBeenCalled()
  })
})

describe('parseMapApply', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('reads every envelope `skillet map --apply --json` prints', () => {
    expect(parseMapApply(LOCKED)).toEqual({ kind: 'locked' })
    expect(parseMapApply(AUTH_REQUIRED)).toEqual({ kind: 'not-connected' })
    expect(parseMapApply('')).toEqual({ kind: 'unavailable' })
    expect(parseMapApply('Usage: skillet [options] [command]')).toEqual({ kind: 'unavailable' })
    const partial = JSON.stringify({
      ok: false,
      data: { result: 'partial', reason: 'registry-unreachable', counts: ZERO, left: { ...ZERO, removals: 2 }, changed: false, later_field: [1] },
    })
    expect(parseMapApply(partial)).toEqual({
      kind: 'done',
      result: 'partial',
      changed: false,
      counts: ZERO,
      left: { ...ZERO, removals: 2 },
    })
  })
})
