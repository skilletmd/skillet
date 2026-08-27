import { describe, it, expect } from 'vitest'
import {
  shouldShowStatsAsk,
  STATS_ASK_MIN_RUNS,
  capturableSkills,
  editedLabelHtml,
  customizedSlugSet,
  isSlugCustomized,
  editedSlugSet,
  syncReachedRegistry,
  collectSyncIssues,
  humanizeSyncReason,
  syncIssueNote,
  checkSyncAction,
  classifySyncFailure,
  cleanCliError,
  eventToAccel,
  heroCardState,
  accessibilityActionLabel,
  permissionRows,
  heroStatusOverride,
  humanizeAppError,
  palettePhaseFrom,
  parkedNotice,
  parkedNoticeCopy,
  prettyAccel,
  resolveTraySyncKits,
  shouldClearApprovalBlock,
  shouldFallbackSyncOnCheckError,
  shouldRunTrayOpenCheck,
  uploadOutcome,
  syncKitsFromListFallback,
  type CustomizedRow,
  type PermissionAgentLike,
  type KitStatus,
  type Skill,
  type SyncKitGroupJson,
} from './tray-logic'

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'x',
  name: 'X',
  description: '',
  owner: null,
  source: 'local',
  pinned: false,
  body: '',
  ...over,
})

describe('sync kit helpers', () => {
  const kit: KitStatus = {
    skills: [],
    groups: [
      { kitRef: '@you/work', synced: true, skills: ['a', 'b'] },
      { kitRef: null, synced: false, skills: ['orphan'] },
    ],
  }

  it('builds kit groups from list fallback', () => {
    const groups = syncKitsFromListFallback(kit)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kitRef).toBe('@you/work')
    expect(groups[0]!.skills).toHaveLength(2)
  })

  it('prefers last sync kits when present', () => {
    const fromSync: SyncKitGroupJson[] = [
      { kitRef: '@sync/only', skills: [{ slug: 'z', status: 'synced' }] },
    ]
    expect(resolveTraySyncKits(kit, fromSync)).toEqual(fromSync)
  })
})

describe('upload helpers', () => {
  it('capturableSkills keeps local skills without owner', () => {
    const skills = [
      skill({ slug: 'local', source: 'local', owner: null }),
      skill({ slug: 'owned', source: 'local', owner: 'you' }),
      skill({ slug: 'reg', source: 'registry', owner: null }),
    ]
    expect(capturableSkills(skills).map((s) => s.slug)).toEqual(['local'])
  })

  const id = (s: string) => s

  it('uploadOutcome: full success carries the published slugs', () => {
    const out = uploadOutcome(
      { ok: true, published: [{ slug: 'a', alreadyExists: false }], failed: [] },
      id,
    )
    expect(out).toEqual({ kind: 'success', publishedSlugs: ['a'] })
  })

  it('uploadOutcome: partial failure is never plain success (R9)', () => {
    const out = uploadOutcome(
      {
        ok: true,
        published: [{ slug: 'good', alreadyExists: false }],
        failed: [{ slug: 'bad', error: 'boom' }],
      },
      id,
    )
    expect(out.kind).toBe('partial')
    if (out.kind === 'partial') {
      expect(out.message).toBe('Uploaded 1. 1 failed: boom')
      expect(out.publishedSlugs).toEqual(['good'])
    }
  })

  it('uploadOutcome: an all-blocked partial keeps the message to counts (findings carry the detail)', () => {
    const out = uploadOutcome(
      {
        ok: true,
        published: [
          { slug: 'good', alreadyExists: false },
          { slug: 'fine', alreadyExists: false },
        ],
        failed: [
          {
            slug: 'bad',
            error: 'Publish blocked: a credential was detected. Remove the secret and republish.',
            findings: [{ category: 'secret', file: 'SKILL.md', line: 10 }],
          },
        ],
      },
      id,
    )
    expect(out.kind).toBe('partial')
    if (out.kind === 'partial') {
      expect(out.message).toBe('Uploaded 2. 1 blocked.')
      expect(out.blocked).toEqual([
        { slug: 'bad', findings: [{ category: 'secret', file: 'SKILL.md', line: 10 }] },
      ])
    }
  })

  it('uploadOutcome: empty and error results route to their own states', () => {
    expect(uploadOutcome({ ok: false, empty: true }, id)).toEqual({ kind: 'empty' })
    expect(
      uploadOutcome({ ok: false, failed: [{ slug: 'x', error: 'denied' }] }, id),
    ).toEqual({ kind: 'error', message: 'denied' })
    expect(uploadOutcome({ ok: false, error: 'offline' }, id)).toEqual({
      kind: 'error',
      message: 'offline',
    })
  })

  it('uploadOutcome: Private warnings ride on a SUCCESS outcome, not an error (R1/R3)', () => {
    const out = uploadOutcome(
      {
        ok: true,
        published: [{ slug: 'cf', alreadyExists: false }],
        failed: [],
        warnings: [
          { slug: 'cf', findings: [{ file: 'SKILL.md', line: 12, category: 'github-pat' }] },
        ],
      },
      id,
    )
    expect(out.kind).toBe('success')
    if (out.kind === 'success') {
      expect(out.publishedSlugs).toEqual(['cf'])
      expect(out.warnings?.[0]?.findings[0]?.category).toBe('github-pat')
    }
  })

  it('uploadOutcome: a legacy findings-less envelope still parses (KTD5 back-compat)', () => {
    const out = uploadOutcome(
      { ok: true, published: [{ slug: 'a', alreadyExists: false }], failed: [] },
      id,
    )
    expect(out).toEqual({ kind: 'success', publishedSlugs: ['a'] })
    // no `warnings` key when the CLI didn't send one
    expect('warnings' in out).toBe(false)
  })

  it('uploadOutcome: a registry block carries the findings on the error outcome, grouped by skill (R3)', () => {
    const out = uploadOutcome(
      {
        ok: false,
        failed: [
          {
            slug: 'cf',
            error: 'Publish blocked: a credential was detected.',
            findings: [{ file: 'SKILL.md', line: 4, category: 'secret' }],
          },
        ],
      },
      id,
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.blocked?.[0]?.slug).toBe('cf')
      expect(out.blocked?.[0]?.findings[0]?.category).toBe('secret')
    }
  })

  it('uploadOutcome: a PARTIAL batch carries the blocked skill findings, not just the warned ones (#2)', () => {
    const out = uploadOutcome(
      {
        ok: true,
        published: [{ slug: 'good', alreadyExists: false }],
        failed: [
          { slug: 'leaky', error: 'Publish blocked: a credential was detected.', findings: [{ file: 'SKILL.md', line: 9, category: 'secret' }] },
        ],
        warnings: [{ slug: 'good', findings: [{ file: 'SKILL.md', line: 2, category: 'obfuscation' }] }],
      },
      id,
    )
    expect(out.kind).toBe('partial')
    if (out.kind === 'partial') {
      // The blocked skill's file:line must survive the partial outcome.
      expect(out.blocked?.[0]?.slug).toBe('leaky')
      expect(out.blocked?.[0]?.findings[0]?.line).toBe(9)
      // The flagged warning still rides along too.
      expect(out.warnings?.[0]?.slug).toBe('good')
    }
  })

  it('uploadOutcome: empty warnings array does not attach a warnings key', () => {
    const out = uploadOutcome(
      { ok: true, published: [{ slug: 'a', alreadyExists: false }], failed: [], warnings: [] },
      id,
    )
    expect(out).toEqual({ kind: 'success', publishedSlugs: ['a'] })
  })
})

describe('humanizeAppError', () => {
  it('maps unknown command to rebuild hint', () => {
    expect(humanizeAppError('unknown command: upload_skills')).toMatch(/rebuild from the latest source/)
  })

  it('maps auth errors to pair-code hint', () => {
    expect(humanizeAppError('not_authenticated')).toMatch(/fresh pair code/)
  })

  it('strips connect failed prefix', () => {
    expect(cleanCliError('connect failed: Invalid code')).toBe('Invalid code')
  })

  it('uses first line of multiline stderr', () => {
    expect(humanizeAppError('already used\nmore detail')).toMatch(/already used/)
  })
})

describe('heroCardState', () => {
  it('returns not-connected when unlinked, regardless of sync signals', () => {
    expect(heroCardState({ linked: false, syncing: true, syncError: true })).toBe('not-connected')
  })

  it('returns syncing when linked and syncing (takes precedence over error)', () => {
    expect(heroCardState({ linked: true, syncing: true, syncError: true })).toBe('syncing')
  })

  it('returns offline when linked, not syncing, and sync failed', () => {
    expect(heroCardState({ linked: true, syncing: false, syncError: true })).toBe('offline')
  })

  it('returns synced when linked, idle, and no error', () => {
    expect(heroCardState({ linked: true, syncing: false, syncError: false })).toBe('synced')
  })
})

// U3/R7: a parked agent folder (macOS access not yet granted) must surface as
// a needs-access notice with a Sync-now affordance, and the resting hero must
// never read as plain "Synced" while any folder is parked.
describe('parkedNotice', () => {
  it('returns null when no adapter is parked (or there are no adapters)', () => {
    expect(parkedNotice(null)).toBeNull()
    expect(parkedNotice([])).toBeNull()
    expect(parkedNotice([{ parked: false }, {}])).toBeNull()
  })

  it('counts parked adapters and reports denial when any grant was refused', () => {
    expect(parkedNotice([{ parked: true }, {}])).toEqual({ count: 1, denied: false })
    expect(parkedNotice([{ parked: true }, { parked: true, parkedDenied: true }])).toEqual({
      count: 2,
      denied: true,
    })
  })
})

describe('parkedNoticeCopy', () => {
  it('asks for a sync to grant access (singular and plural)', () => {
    expect(parkedNoticeCopy({ count: 1, denied: false })).toEqual({
      title: '1 agent folder needs access',
      detail: 'Sync now to grant it.',
      action: { label: 'Sync now', kind: 'sync' },
    })
    expect(parkedNoticeCopy({ count: 3, denied: false })).toEqual({
      title: '3 agent folders need access',
      detail: 'Sync now to grant them.',
      action: { label: 'Sync now', kind: 'sync' },
    })
  })

  it('routes to System Settings after a denial', () => {
    expect(parkedNoticeCopy({ count: 1, denied: true }).detail).toBe(
      'Allow Skillet in System Settings under Privacy and Security, then sync.',
    )
  })

  // U1/R3: macOS never re-prompts once a grant is refused, so the denied
  // notice's action must open System Settings. Re-running the sync is the one
  // thing that provably cannot help, and shipping it as the only affordance is
  // what left a denied person with no way back.
  it('offers System Settings, not another sync, once a grant was denied', () => {
    expect(parkedNoticeCopy({ count: 2, denied: true }).action).toEqual({
      label: 'Open System Settings',
      kind: 'settings',
    })
  })

  it('always offers an action that leads somewhere (R3)', () => {
    for (const count of [1, 2, 7]) {
      for (const denied of [false, true]) {
        const { action } = parkedNoticeCopy({ count, denied })
        expect(action.label.length).toBeGreaterThan(0)
        expect(['sync', 'settings']).toContain(action.kind)
      }
    }
  })

  it('never uses an em-dash (product copy rule)', () => {
    for (const notice of [
      { count: 1, denied: false },
      { count: 2, denied: false },
      { count: 1, denied: true },
    ]) {
      const copy = parkedNoticeCopy(notice)
      expect(copy.title).not.toContain('—')
      expect(copy.detail).not.toContain('—')
      expect(copy.action.label).not.toContain('—')
    }
  })
})

// U7/R10: the macOS Accessibility prompt is one-per-app. The old flow fired it
// AND opened System Settings every time, so a first-time ask put two surfaces
// on screen at once and a repeat ask promised a prompt that could never appear.
describe('accessibilityActionLabel', () => {
  it('offers to allow while a prompt can still appear', () => {
    expect(accessibilityActionLabel(false)).toBe('Allow access')
  })

  it('routes to System Settings once the prompt is spent', () => {
    expect(accessibilityActionLabel(true)).toBe('Open System Settings')
  })

  it('never uses an em-dash (product copy rule)', () => {
    expect(accessibilityActionLabel(false)).not.toContain('—')
    expect(accessibilityActionLabel(true)).not.toContain('—')
  })
})

// U4/R3/R4/R12: Settings carries a Permissions block that is present whether or
// not anything is wrong, and every row with a problem carries an action that
// can change that state. Before this, nothing in the app ever reported which
// permissions Skillet held; folder state existed only as a dismissible notice.
describe('permissionRows', () => {
  const agent = (over: Partial<PermissionAgentLike> = {}): PermissionAgentLike => ({
    name: 'claude-code',
    label: 'Claude Code',
    ...over,
  })
  const base = { isMac: true, accessibilityGranted: true, accessibilityAsked: false }
  const protectedAt = (anchor: string, grant: string) => ({
    protected: true,
    grant,
    anchor,
  })

  it('renders nothing off macOS (R12)', () => {
    expect(
      permissionRows({
        ...base,
        isMac: false,
        agents: [agent({ access: protectedAt('/Users/x/Documents', 'none') })],
      }),
    ).toEqual([])
  })

  it('is present with nothing wrong, and offers no action then (R4)', () => {
    const rows = permissionRows({ ...base, agents: [agent()] })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('accessibility')
    expect(rows[0]!.state).toBe('allowed')
    expect(rows[0]!.action).toBeNull()
  })

  it('offers the accessibility ask when it is not granted', () => {
    const rows = permissionRows({ ...base, accessibilityGranted: false, agents: [agent()] })
    expect(rows[0]!.state).toBe('not-allowed')
    expect(rows[0]!.action).toEqual({ label: 'Allow access', kind: 'ax-request' })
  })

  it('labels the accessibility ask honestly once the prompt is spent', () => {
    const rows = permissionRows({
      ...base,
      accessibilityGranted: false,
      accessibilityAsked: true,
      agents: [agent()],
    })
    expect(rows[0]!.action?.label).toBe('Open System Settings')
  })

  it('adds no folder row for an unprotected agent folder', () => {
    const rows = permissionRows({
      ...base,
      agents: [agent({ access: { protected: false, grant: 'none', anchor: null } })],
    })
    expect(rows).toHaveLength(1)
  })

  it('adds no folder row when the sidecar is too old to report access', () => {
    // Version skew must degrade to today's behaviour, never to a false alarm.
    const rows = permissionRows({ ...base, agents: [agent({ access: undefined })] })
    expect(rows).toHaveLength(1)
  })

  it('offers a sync for a protected folder with no grant yet', () => {
    const rows = permissionRows({
      ...base,
      agents: [agent({ access: protectedAt('/Users/x/Documents', 'none') })],
    })
    const folder = rows.find((r) => r.id.startsWith('folder:'))
    expect(folder?.state).toBe('needs-access')
    expect(folder?.action).toEqual({
      label: 'Sync now',
      kind: 'folder-sync',
      anchor: '/Users/x/Documents',
    })
  })

  it('offers a retry, not another sync, for a denied folder', () => {
    const rows = permissionRows({
      ...base,
      agents: [agent({ access: protectedAt('/Users/x/Documents', 'suspended') })],
    })
    const folder = rows.find((r) => r.id.startsWith('folder:'))
    expect(folder?.state).toBe('denied')
    expect(folder?.action).toEqual({
      label: 'Try again',
      kind: 'folder-retry',
      anchor: '/Users/x/Documents',
    })
  })

  it('reports a granted folder as allowed, with nothing to do', () => {
    const rows = permissionRows({
      ...base,
      agents: [agent({ access: protectedAt('/Users/x/Documents', 'active') })],
    })
    const folder = rows.find((r) => r.id.startsWith('folder:'))
    expect(folder?.state).toBe('allowed')
    expect(folder?.action).toBeNull()
  })

  it('collapses two agents under one anchor into one row', () => {
    // macOS scopes consent per protected folder, so two rows would offer the
    // same grant twice and a second press would do nothing.
    const rows = permissionRows({
      ...base,
      agents: [
        agent({ name: 'claude-code', access: protectedAt('/Users/x/Documents', 'none') }),
        agent({ name: 'codex', label: 'Codex', access: protectedAt('/Users/x/Documents', 'none') }),
      ],
    })
    expect(rows.filter((r) => r.id.startsWith('folder:'))).toHaveLength(1)
  })

  it('keeps separate anchors as separate rows', () => {
    const rows = permissionRows({
      ...base,
      agents: [
        agent({ name: 'claude-code', access: protectedAt('/Users/x/Documents', 'none') }),
        agent({ name: 'codex', label: 'Codex', access: protectedAt('/Users/x/Desktop', 'suspended') }),
      ],
    })
    expect(rows.filter((r) => r.id.startsWith('folder:'))).toHaveLength(2)
  })

  it('never leaves a problem row without an action (R3)', () => {
    for (const grant of ['none', 'suspended', 'active']) {
      for (const granted of [true, false]) {
        const rows = permissionRows({
          ...base,
          accessibilityGranted: granted,
          agents: [agent({ access: protectedAt('/Users/x/Documents', grant) })],
        })
        for (const row of rows) {
          expect(row.label.length).toBeGreaterThan(0)
          if (row.state !== 'allowed') {
            expect(row.action, `${row.id} in state ${row.state} has no action`).toBeTruthy()
            expect(row.action!.label.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('never uses an em-dash (product copy rule)', () => {
    const rows = permissionRows({
      ...base,
      accessibilityGranted: false,
      agents: [agent({ access: protectedAt('/Users/x/Documents', 'suspended') })],
    })
    for (const row of rows) {
      expect(row.label).not.toContain('—')
      expect(row.detail).not.toContain('—')
      expect(row.action?.label ?? '').not.toContain('—')
    }
  })
})

describe('heroStatusOverride', () => {
  it('replaces the resting synced status while a folder is parked', () => {
    expect(heroStatusOverride('synced', { count: 1, denied: false })).toBe('Needs access')
    expect(heroStatusOverride('synced', { count: 2, denied: true })).toBe('Needs access')
  })

  it('leaves every other state alone', () => {
    expect(heroStatusOverride('synced', null)).toBeNull()
    expect(heroStatusOverride('syncing', { count: 1, denied: false })).toBeNull()
    expect(heroStatusOverride('offline', { count: 1, denied: false })).toBeNull()
    expect(heroStatusOverride('not-connected', { count: 1, denied: false })).toBeNull()
  })
})

// U7 dropped the tray's held-update decision card. What remains here is the
// quiet "Edited locally" label + the selection helpers that drive the row's
// "See changes" action (which opens the viewer window). The reconcile decision
// now lives on the web (/updates) and the viewer, not the tray.
const custRow = (over: Partial<CustomizedRow> = {}): CustomizedRow => ({
  slug: '@alice/foo',
  ref: '@alice/foo',
  customized: true,
  hasUpdate: true,
  version: 3,
  held: { version: 4, hash: 'abc' },
  ...over,
})

describe('customized: quiet label + selection helpers (R14)', () => {
  it('the "Edited locally" label is a quiet subtitle span — no pill, no hover tooltip', () => {
    // "Edited locally" (not bare "Edited") on the subtitle line — no pill, and
    // no hover tooltip (native apps don't hover-to-explain state).
    const html = editedLabelHtml()
    expect(html).toContain('Edited locally')
    expect(html).toContain('lib-edited')
    expect(html).not.toContain('title=')
  })

  it('customizedSlugSet + isSlugCustomized match on the bare slug across ref shapes', () => {
    const set = customizedSlugSet([custRow({ ref: '@alice/foo' })])
    expect(isSlugCustomized('@alice/foo', set)).toBe(true)
    expect(isSlugCustomized('foo', set)).toBe(true)
    expect(isSlugCustomized('bar', set)).toBe(false)
  })

  it('editedSlugSet unions persisted customized rows with unreconciled live edits', () => {
    const set = editedSlugSet([custRow({ ref: '@alice/foo' })], ['@openclaudia/serp-analyzer'])
    // Persisted customized skill.
    expect(isSlugCustomized('foo', set)).toBe(true)
    // Live edit surfaced on tray-open before a full sync marks it customized.
    expect(isSlugCustomized('@openclaudia/serp-analyzer', set)).toBe(true)
    expect(isSlugCustomized('serp-analyzer', set)).toBe(true)
    expect(isSlugCustomized('other', set)).toBe(false)
  })

  it('editedSlugSet with no live edits equals the customized set', () => {
    expect([...editedSlugSet([custRow({ ref: '@alice/foo' })], [])]).toEqual([
      ...customizedSlugSet([custRow({ ref: '@alice/foo' })]),
    ])
  })
})

describe('sync resilience: reachable vs offline + issue surfacing', () => {
  it('syncReachedRegistry is true when ANY per-skill response is present', () => {
    // unionPull alone proves the registry answered — even with 0 adapters.
    expect(syncReachedRegistry({ unionPull: [{ slug: '@a/b', status: 'failed' }] })).toBe(true)
    expect(syncReachedRegistry({ adapters: [{ name: 'claude' }] })).toBe(true)
    expect(syncReachedRegistry({ kits: [{}] })).toBe(true)
  })

  it('syncReachedRegistry is false only for a bodyless response (the real offline case)', () => {
    expect(syncReachedRegistry({})).toBe(false)
    expect(syncReachedRegistry({ unionPull: [], adapters: [], kits: [] })).toBe(false)
  })

  it('collectSyncIssues surfaces per-skill failures, deduped by slug', () => {
    const issues = collectSyncIssues({
      unionPull: [
        { slug: '@openclaudia/serp-analyzer', status: 'failed', reason: 'corrupt_storage: x' },
        { slug: '@devops-dan/k8s-debug', status: 'unchanged' },
        { slug: '@openclaudia/serp-analyzer', status: 'failed', reason: 'scan_pending: y' },
      ],
    })
    expect(issues).toEqual([
      { slug: '@openclaudia/serp-analyzer', reason: "the author's security scan hasn't finished" },
    ])
  })

  it('collectSyncIssues is empty on a clean sync', () => {
    expect(collectSyncIssues({ unionPull: [{ slug: '@a/b', status: 'unchanged' }] })).toEqual([])
    expect(collectSyncIssues({})).toEqual([])
  })

  it('humanizeSyncReason maps known codes and strips unknown prefixes', () => {
    expect(humanizeSyncReason('corrupt_storage: missing blobs')).toBe("this version can't be verified yet")
    expect(humanizeSyncReason('scan_pending: not done')).toBe("the author's security scan hasn't finished")
    expect(humanizeSyncReason('weird_code: something broke')).toBe('something broke')
    expect(humanizeSyncReason(undefined)).toBe('it could not be synced')
  })

  it('humanizeSyncReason names the pin-recovery command for a rotated author key', () => {
    expect(
      humanizeSyncReason(
        'key_id_mismatch: key_id_mismatch: author_key_changed: handle wshobson pinned to 1f7859e6, registry served 440566bd',
      ),
    ).toBe('the signing key for @wshobson changed. Run skillet pin accept wshobson to trust the new one')
    expect(humanizeSyncReason('key_id_mismatch: no handle here')).toBe(
      "the author's signing key changed",
    )
  })

  it('syncIssueNote leads with the shared reason instead of listing every slug', () => {
    const reason = 'the signing key for @wshobson changed'
    const issues = Array.from({ length: 167 }, (_, i) => ({
      slug: `@wshobson/skill-${i}`,
      reason,
    }))
    expect(syncIssueNote(issues)).toEqual({
      title: "167 skills from @wshobson couldn't sync",
      detail: reason,
    })
  })

  it('syncIssueNote falls back to slugs for a mixed batch, and stays singular for one', () => {
    expect(
      syncIssueNote([
        { slug: '@a/one', reason: 'r1' },
        { slug: '@b/two', reason: 'r2' },
      ]),
    ).toEqual({ title: "2 skills couldn't sync", detail: 'one, two' })
    expect(syncIssueNote([{ slug: '@a/one', reason: 'r1' }])).toEqual({
      title: "Couldn't sync one",
      detail: 'r1',
    })
  })
})

describe('shortcut display', () => {
  it('prettyAccel maps Control+Shift+KeyS', () => {
    expect(prettyAccel('Control+Shift+KeyS')).toBe('⌃⇧S')
  })

  it('eventToAccel rejects bare modifier key', () => {
    expect(eventToAccel({ code: 'ShiftLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true })).toBeNull()
  })

  it('eventToAccel builds chord with modifier', () => {
    expect(
      eventToAccel({
        code: 'KeyS',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe('Control+Shift+KeyS')
  })
})

describe('tray open sync throttle', () => {
  it('shouldRunTrayOpenCheck respects min gap', () => {
    expect(shouldRunTrayOpenCheck(100_000, 0, 90_000)).toBe(true)
    expect(shouldRunTrayOpenCheck(100_000, 50_000, 90_000)).toBe(false)
  })

  it('shouldFallbackSyncOnCheckError only when daily stale', () => {
    const day = 22 * 60 * 60 * 1000
    expect(shouldFallbackSyncOnCheckError(day + 1, 0, day)).toBe(true)
    expect(shouldFallbackSyncOnCheckError(1_000, 0, day)).toBe(false)
  })
})


describe('classifySyncFailure', () => {
  it('classifies the structured machine_disconnected code regardless of message', () => {
    expect(classifySyncFailure({ code: 'machine_disconnected', message: 'anything' })).toBe(
      'disconnected',
    )
    expect(classifySyncFailure({ code: 'machine_disconnected' })).toBe('disconnected')
  })

  it('classifies the registry min-version gate (client_upgrade_required) as upgrade-required', () => {
    expect(
      classifySyncFailure({ code: 'client_upgrade_required', message: 'Please update Skillet.' }),
    ).toBe('upgrade-required')
    expect(classifySyncFailure({ code: 'client_upgrade_required' })).toBe('upgrade-required')
  })

  it('falls back to the pinned prose for older sidecars without a code', () => {
    expect(
      classifySyncFailure({
        message:
          'This machine was disconnected from your account. Get a pair code at skillet.md → Settings → Devices and run `skillet connect <code>`.',
      }),
    ).toBe('disconnected')
  })

  it('classifies approval/quarantine blocks (ported isApprovalBlock cases)', () => {
    expect(classifySyncFailure({ message: 'update requires approval' })).toBe('approval-block')
    expect(classifySyncFailure({ message: 'skill quarantined pending review' })).toBe(
      'approval-block',
    )
    expect(classifySyncFailure({ message: 'set APPROVE_PRE to continue' })).toBe('approval-block')
    expect(classifySyncFailure({ message: 'rerun with --allow-quarantined' })).toBe(
      'approval-block',
    )
    expect(classifySyncFailure({ message: 'this update needs review' })).toBe('approval-block')
  })

  it('everything else is offline', () => {
    expect(classifySyncFailure({ message: 'Registry request failed: fetch failed' })).toBe(
      'offline',
    )
    expect(classifySyncFailure({ code: 'network_error', message: 'fetch failed' })).toBe('offline')
    expect(classifySyncFailure({ message: '' })).toBe('offline')
    expect(classifySyncFailure({})).toBe('offline')
  })

  it('an unknown code with disconnect prose still detects via the message', () => {
    expect(
      classifySyncFailure({ code: 'other', message: 'machine was Disconnected From Your Account' }),
    ).toBe('disconnected')
  })

  it('routes the CLI unpaired envelope to the auth gate — never approval-block or offline', () => {
    // `skillet sync --json` unpaired prints
    // {"ok":false,"error":"auth_required","code":"auth_required","message":"…"}
    // on stdout; the desktop unwrap passes code + error through.
    expect(classifySyncFailure({ code: 'auth_required', message: 'auth_required' })).toBe(
      'auth-required',
    )
    expect(classifySyncFailure({ code: 'auth_required' })).toBe('auth-required')
    // Some unwrap paths only surface the error string as the message.
    expect(classifySyncFailure({ message: 'auth_required' })).toBe('auth-required')
  })

  it('detects the unpaired stderr prose from non-JSON command paths', () => {
    expect(
      classifySyncFailure({
        message:
          'This machine is not paired to an account. Sign in on https://skillet.md, get a pair code at https://skillet.md/settings/devices, then run `skillet connect <code>`.',
      }),
    ).toBe('auth-required')
  })
})

describe('palettePhaseFrom', () => {
  it('cold-start inside the app (CLI not ready) is loading, never picker (no mock leak)', () => {
    expect(
      palettePhaseFrom({ preview: false, previewAuthOut: false, cliReady: false, unpaired: false }),
    ).toBe('loading')
  })

  it('CLI ready + paired → picker; ready + unpaired → gate', () => {
    expect(
      palettePhaseFrom({ preview: false, previewAuthOut: false, cliReady: true, unpaired: false }),
    ).toBe('picker')
    expect(
      palettePhaseFrom({ preview: false, previewAuthOut: false, cliReady: true, unpaired: true }),
    ).toBe('gate')
  })

  it('browser preview maps straight to gate/picker (design surface)', () => {
    expect(
      palettePhaseFrom({ preview: true, previewAuthOut: false, cliReady: false, unpaired: false }),
    ).toBe('picker')
    expect(
      palettePhaseFrom({ preview: true, previewAuthOut: true, cliReady: false, unpaired: false }),
    ).toBe('gate')
  })
})

describe('checkSyncAction', () => {
  it('disconnected envelope sets the flag and never syncs', () => {
    expect(
      checkSyncAction({ ok: false, changed: true, code: 'machine_disconnected', error: 'x' }),
    ).toEqual({
      setDisconnected: true,
      clearDisconnected: false,
      setUpgradeRequired: false,
      clearUpgradeRequired: false,
      // The registry authoritatively rejected the token — it answered, so a
      // stale Offline paint alongside the reconnect gate would be wrong.
      clearSyncError: true,
      runSync: false,
    })
  })

  it('partial per-skill failure keeps the changed→sync trigger and clears a stale Offline', () => {
    // Real --check partial failures carry per-item arrays and no error string;
    // the arrays are the reachability proof.
    expect(
      checkSyncAction({
        ok: false,
        changed: true,
        unionPull: [{ slug: '@a/b', status: 'failed', reason: 'scan_pending: …' }],
      }),
    ).toEqual({
      setDisconnected: false,
      clearDisconnected: false,
      setUpgradeRequired: false,
      clearUpgradeRequired: false,
      clearSyncError: true,
      runSync: true,
    })
    // A bodyless generic failure proves nothing — keep the latch.
    expect(checkSyncAction({ ok: false, changed: true, error: 'one skill failed' })).toEqual({
      setDisconnected: false,
      clearDisconnected: false,
      setUpgradeRequired: false,
      clearUpgradeRequired: false,
      clearSyncError: false,
      runSync: true,
    })
  })

  it('offline failure envelope does nothing and keeps the Offline latch', () => {
    expect(checkSyncAction({ ok: false, error: 'Registry request failed: fetch failed' })).toEqual({
      setDisconnected: false,
      clearDisconnected: false,
      setUpgradeRequired: false,
      clearUpgradeRequired: false,
      clearSyncError: false,
      runSync: false,
    })
  })

  it('unpaired (auth_required) envelope never sets a flag or syncs, but is not Offline', () => {
    expect(
      checkSyncAction({ ok: false, error: 'auth_required', code: 'auth_required' }),
    ).toEqual({
      setDisconnected: false,
      clearDisconnected: false,
      setUpgradeRequired: false,
      clearUpgradeRequired: false,
      clearSyncError: true,
      runSync: false,
    })
  })

  it('upgrade-required envelope sets the upgrade flag and never syncs, but is not Offline', () => {
    expect(
      checkSyncAction({ ok: false, changed: true, code: 'client_upgrade_required' }),
    ).toEqual({
      setDisconnected: false,
      clearDisconnected: false,
      setUpgradeRequired: true,
      clearUpgradeRequired: false,
      clearSyncError: true,
      runSync: false,
    })
  })

  it('clean success clears BOTH sticky flags plus the Offline latch and syncs on changed', () => {
    expect(checkSyncAction({ ok: true, changed: true })).toEqual({
      setDisconnected: false,
      clearDisconnected: true,
      setUpgradeRequired: false,
      clearUpgradeRequired: true,
      clearSyncError: true,
      runSync: true,
    })
    expect(checkSyncAction({ changed: false })).toEqual({
      setDisconnected: false,
      clearDisconnected: true,
      setUpgradeRequired: false,
      clearUpgradeRequired: true,
      clearSyncError: true,
      runSync: false,
    })
  })

  it('only a connectivity-classified failure withholds the Offline clear', () => {
    // The stale-latch scenario: every parsed envelope except an offline
    // classification proves the registry (or an authoritative local guard)
    // answered, so the tray-open check must clear a lingering "Offline".
    const reachable = [
      { ok: true as const },
      {
        ok: false as const,
        unionPull: [{ slug: '@a/b', status: 'failed', reason: 'scan_pending: …' }],
      },
      { ok: false as const, error: 'auth_required', code: 'auth_required' },
      { ok: false as const, code: 'machine_disconnected', error: 'x' },
      { ok: false as const, code: 'client_upgrade_required' },
    ]
    for (const envelope of reachable) {
      expect(checkSyncAction(envelope).clearSyncError).toBe(true)
    }
    expect(
      checkSyncAction({ ok: false, error: 'Registry request failed: fetch failed' })
        .clearSyncError,
    ).toBe(false)
  })
})

describe('shouldClearApprovalBlock', () => {
  it('clears the latch on a confirmed-empty queue (approved elsewhere → stale block)', () => {
    expect(shouldClearApprovalBlock(0)).toBe(true)
  })

  it('keeps the latch when items are genuinely pending', () => {
    expect(shouldClearApprovalBlock(3)).toBe(false)
    expect(shouldClearApprovalBlock(1)).toBe(false)
  })

  it('keeps the latch on a transient read failure (null ≠ authoritative empty)', () => {
    expect(shouldClearApprovalBlock(null)).toBe(false)
  })
})

describe('shouldShowStatsAsk', () => {
  const base = {
    paired: true,
    consentChosen: false as boolean | null,
    locallyDismissed: false,
    localRuns: STATS_ASK_MIN_RUNS,
  }
  it('shows only for paired + unanswered + not dismissed + enough stats', () => {
    expect(shouldShowStatsAsk(base)).toBe(true)
  })
  it('waits for a habit — below the run threshold the chart pitch lands flat', () => {
    expect(shouldShowStatsAsk({ ...base, localRuns: 0 })).toBe(false)
    expect(shouldShowStatsAsk({ ...base, localRuns: STATS_ASK_MIN_RUNS - 1 })).toBe(false)
  })
  it('never shows unpaired', () => {
    expect(shouldShowStatsAsk({ ...base, paired: false })).toBe(false)
  })
  it('never shows once the question was answered anywhere', () => {
    expect(shouldShowStatsAsk({ ...base, consentChosen: true })).toBe(false)
  })
  it('treats unknown consent state (old sidecar, fetch error) as no card', () => {
    expect(shouldShowStatsAsk({ ...base, consentChosen: null })).toBe(false)
  })
  it('respects the local dismissal', () => {
    expect(shouldShowStatsAsk({ ...base, locallyDismissed: true })).toBe(false)
  })
})
