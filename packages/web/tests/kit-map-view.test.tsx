import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { JOBS, TOOLS_SECTION } from '@skillet/protocol/jobs'
import {
  parseKitMapScan,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapLooked,
  type KitMapScan,
  type KitMapUnchecked,
} from '@skillet/protocol/kit-map'
import { HOME_PICKS } from '@/lib/packs/home-picks'
import { KitMapView, type SaveState } from '@/components/map/kit-map-view'
import { DEMO_SCAN } from '@/app/map/embed/map-embed'

// The framed map draws a scan it was handed and drafts fixes on it. Nothing
// here touches the network: the view is pure over (scan, drafts), and every
// fix goes out through onDraftsChange.

let seq = 0
const nextKey = () => `sha256:${(++seq).toString(16).padStart(64, '0')}`

function entry(name: string, over: Partial<KitMapEntry> = {}): KitMapEntry {
  return {
    key: nextKey(),
    name,
    description: '',
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job: null,
    usage: { state: 'used', reason: null },
    ...over,
  }
}

const plugin = (name: string, pluginName: string, over: Partial<KitMapEntry> = {}): KitMapEntry =>
  entry(name, { source: 'plugin', from: { kind: 'plugin', name: pluginName, on: true }, ...over })

function scanOf(
  entries: KitMapEntry[],
  looked: KitMapLooked[] = [{ tool: 'claude-code', history: 'read' }],
  unchecked: KitMapUnchecked[] = [],
): KitMapScan {
  const scan = { entries, looked, unchecked }
  // Every fixture is a scan the bridge would accept.
  expect(parseKitMapScan(scan), 'fixture is a valid scan').not.toBeNull()
  return scan
}

function mount(scan: KitMapScan, props: { save?: SaveState; onSave?: () => void; onReopen?: () => void } = {}) {
  const changes = vi.fn<(drafts: KitMapDraft[]) => void>()
  function Harness() {
    const [drafts, setDrafts] = useState<KitMapDraft[]>([])
    return (
      <KitMapView
        scan={scan}
        drafts={drafts}
        onDraftsChange={(next) => {
          changes(next)
          setDrafts(next)
        }}
        save={props.save ?? { phase: 'idle' }}
        onSave={props.onSave ?? (() => {})}
        onReopen={props.onReopen ?? (() => {})}
      />
    )
  }
  render(<Harness />)
  const latest = (): KitMapDraft[] => changes.mock.calls.at(-1)?.[0] ?? []
  return { changes, latest }
}

/** Opens a section's sheet from the map and returns it. */
function openSection(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('dialog', { name })
}

const job = (sheet: HTMLElement, name: string) => within(sheet).getByRole('group', { name })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('marks and fixes', () => {
  it('two local Editing skills mark Editing with Merge', () => {
    const a = entry('Plain Prose', { job: 'writing.editing' })
    const b = entry('Copy Editor', { job: 'writing.editing' })
    const { latest } = mount(scanOf([a, b]))
    const editing = job(openSection('Writing'), 'Editing')
    expect(within(editing).getByText('2 skills do this job.')).toBeInTheDocument()
    fireEvent.click(within(editing).getByRole('button', { name: /^Merge/ }))
    expect(latest()).toEqual([{ kind: 'merge', job: 'writing.editing', keys: [a.key, b.key] }])
  })

  it('two plugin skills in Code review name both plugins and offer no Merge', () => {
    const scan = scanOf([
      plugin('Code Review', 'compound-engineering', { job: 'development.code-review' }),
      plugin('Requesting Code Review', 'superpowers', { job: 'development.code-review' }),
    ])
    mount(scan)
    const review = job(openSection('Development'), 'Code review')
    expect(review).toHaveTextContent('compound-engineering')
    expect(review).toHaveTextContent('superpowers')
    expect(review).toHaveTextContent(/turn off/i)
    expect(within(review).queryByRole('button', { name: /^Merge/ })).toBeNull()
  })

  it('Platforms with 16 skills shows no doubled mark, and lists all 16 with working Move and Remove', () => {
    const stacks = Array.from({ length: 16 }, (_, i) => entry(`Stack ${i + 1}`, { job: 'development.platforms' }))
    const { latest } = mount(scanOf(stacks))
    const sheet = openSection('Development')
    const platforms = job(sheet, 'Platforms')
    expect(platforms).not.toHaveTextContent(/skills do this job/)
    expect(within(platforms).queryByRole('button', { name: /^Merge/ })).toBeNull()
    expect(within(platforms).getAllByRole('listitem')).toHaveLength(16)
    expect(within(platforms).getAllByRole('button', { name: /^Move Stack/ })).toHaveLength(16)
    expect(within(platforms).getAllByRole('button', { name: /^Remove Stack/ })).toHaveLength(16)

    fireEvent.click(within(platforms).getByRole('button', { name: 'Remove Stack 3' }))
    expect(latest()).toEqual([{ kind: 'remove', key: stacks[2]!.key }])

    fireEvent.click(within(platforms).getByRole('button', { name: 'Move Stack 16' }))
    const picker = screen.getByRole('dialog', { name: 'Move Stack 16' })
    fireEvent.click(within(picker).getByRole('button', { name: 'Tests' }))
    expect(latest()).toEqual([
      { kind: 'remove', key: stacks[2]!.key },
      { kind: 'move', key: stacks[15]!.key, job: 'development.tests' },
    ])
    // Back on the section, the moved skill now sits in Tests.
    const tests = job(screen.getByRole('dialog', { name: 'Development' }), 'Tests')
    expect(tests).toHaveTextContent('Stack 16')
  })

  it('an unused skill offers Remove; an unknown one shows no mark, and the header line gives the reason (AE2)', () => {
    const unused = entry('Old Helper', { job: 'research.summaries', usage: { state: 'unused', reason: 'no-recent-run' } })
    const unknown = entry('Cursor Rules', {
      job: 'research.reports',
      tools: [{ tool: 'cursor', copies: 1 }],
      usage: { state: 'unknown', reason: 'no-history' },
    })
    const { latest } = mount(
      scanOf([unused, unknown], [
        { tool: 'claude-code', history: 'read' },
        { tool: 'cursor', history: 'none' },
      ]),
    )
    expect(screen.getByText(/Looked in Claude Code and Cursor\. Usage is unknown for Cursor\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See why' }))
    expect(screen.getByRole('dialog', { name: "Couldn't check" })).toHaveTextContent(
      "Usage in CursorSkillet can't read its history, so its skills have no unused mark.",
    )
    fireEvent.keyDown(screen.getByRole('dialog', { name: "Couldn't check" }), { key: 'Escape' })
    const sheet = openSection('Research')
    expect(job(sheet, 'Summaries')).toHaveTextContent('No runs in 30 days')
    expect(job(sheet, 'Reports')).not.toHaveTextContent('No runs in 30 days')
    fireEvent.click(within(job(sheet, 'Summaries')).getByRole('button', { name: 'Remove Old Helper' }))
    expect(latest()).toEqual([{ kind: 'remove', key: unused.key }])
  })

  it('an empty job with a pick offers Fill; a job with none says so', () => {
    const { latest } = mount(scanOf([entry('Long Form', { job: 'writing.long-reads' })]))
    const sheet = openSection('Writing')
    const pick = HOME_PICKS['writing.editing'][0]!
    fireEvent.click(within(job(sheet, 'Editing')).getByRole('button', { name: `Add ${pick.name} to Editing` }))
    expect(latest()).toEqual([{ kind: 'fill', job: 'writing.editing', ref: `@${pick.handle}/${pick.slug}` }])
    expect(HOME_PICKS['writing.emails']).toEqual([])
    expect(job(sheet, 'Emails')).toHaveTextContent('No skill for this on Skillet yet.')
    expect(within(job(sheet, 'Emails')).queryByRole('button', { name: /^Add/ })).toBeNull()
  })

  it('an empty scan shows every job empty and one action that fills every job with a pick', () => {
    const { latest } = mount(scanOf([]))
    expect(screen.getByRole('img', { name: 'Your kit: 0 of 46 jobs filled' })).toBeInTheDocument()
    const withPick = [...JOBS, ...TOOLS_SECTION.jobs].filter((j) => HOME_PICKS[j.id].length > 0)
    const fill = screen.getByRole('button', { name: `Fill ${withPick.length} jobs` })
    fireEvent.click(fill)
    expect(latest()).toEqual(
      withPick.map((j) => {
        const pick = HOME_PICKS[j.id][0]!
        return { kind: 'fill', job: j.id, ref: `@${pick.handle}/${pick.slug}` }
      }),
    )
    expect(screen.queryByRole('button', { name: /^Fill \d+/ })).toBeNull()
  })

  it('Fill, Remove, Merge and Move each draft one change that shows at once, and Undo removes it', () => {
    const a = entry('Plain Prose', { job: 'writing.editing' })
    const b = entry('Copy Editor', { job: 'writing.editing' })
    const c = entry('Readme Writer', { job: 'writing.docs' })
    const { latest } = mount(scanOf([a, b, c]))
    const sheet = openSection('Writing')

    // Fill
    const pick = HOME_PICKS['writing.short-posts'][0]!
    fireEvent.click(within(job(sheet, 'Short posts')).getByRole('button', { name: `Add ${pick.name} to Short posts` }))
    expect(latest()).toHaveLength(1)
    fireEvent.click(within(job(sheet, 'Short posts')).getByRole('button', { name: /^Undo/ }))
    expect(latest()).toEqual([])

    // Remove
    fireEvent.click(within(job(sheet, 'Docs')).getByRole('button', { name: 'Remove Readme Writer' }))
    expect(latest()).toEqual([{ kind: 'remove', key: c.key }])
    expect(job(sheet, 'Docs')).toHaveTextContent('Removed')
    fireEvent.click(within(job(sheet, 'Docs')).getByRole('button', { name: 'Undo removing Readme Writer' }))
    expect(latest()).toEqual([])

    // Merge
    fireEvent.click(within(job(sheet, 'Editing')).getByRole('button', { name: /^Merge/ }))
    expect(latest()).toEqual([{ kind: 'merge', job: 'writing.editing', keys: [a.key, b.key] }])
    expect(job(sheet, 'Editing')).toHaveTextContent('Merging 2 skills')
    fireEvent.click(within(job(sheet, 'Editing')).getByRole('button', { name: /^Undo/ }))
    expect(latest()).toEqual([])

    // Move
    fireEvent.click(within(job(sheet, 'Docs')).getByRole('button', { name: 'Move Readme Writer' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Move Readme Writer' })).getByRole('button', { name: 'Long reads' }))
    expect(latest()).toEqual([{ kind: 'move', key: c.key, job: 'writing.long-reads' }])
    const after = screen.getByRole('dialog', { name: 'Writing' })
    expect(job(after, 'Long reads')).toHaveTextContent('Readme Writer')
    expect(job(after, 'Docs')).toHaveTextContent('Moved to Long reads')
    fireEvent.click(within(job(after, 'Docs')).getByRole('button', { name: 'Undo moving Readme Writer' }))
    expect(latest()).toEqual([])
  })

  it('a merge a Remove takes below two skills shows as inactive', () => {
    const a = entry('Plain Prose', { job: 'writing.editing' })
    const b = entry('Copy Editor', { job: 'writing.editing' })
    const { latest } = mount(scanOf([a, b]))
    const editing = () => job(screen.getByRole('dialog', { name: 'Writing' }), 'Editing')
    openSection('Writing')
    fireEvent.click(within(editing()).getByRole('button', { name: /^Merge/ }))
    fireEvent.click(within(editing()).getByRole('button', { name: 'Remove Copy Editor' }))
    expect(latest()).toHaveLength(2)
    expect(editing()).toHaveTextContent('Merge needs two skills here.')
  })

  it("a plugin skill's Remove names the plugin and offers no trash (AE3)", () => {
    const skill = plugin('Debug Helper', 'compound-engineering', {
      job: 'development.debugging',
      usage: { state: 'unused', reason: 'no-recent-run' },
    })
    const { changes } = mount(scanOf([skill]))
    const debugging = job(openSection('Development'), 'Debugging')
    fireEvent.click(within(debugging).getByRole('button', { name: 'Remove Debug Helper' }))
    expect(changes).not.toHaveBeenCalled()
    expect(debugging).toHaveTextContent('Part of the compound-engineering plugin. To remove it, turn the plugin off in Claude Code.')
  })

  it("an unused skill of a turned-off plugin says 'Plugin is off' and has no Remove", () => {
    const skill = plugin('Old Debug', 'retired-kit', {
      job: 'development.debugging',
      usage: { state: 'unused', reason: 'no-recent-run' },
      from: { kind: 'plugin', name: 'retired-kit', on: false },
    })
    mount(scanOf([skill]))
    const debugging = job(openSection('Development'), 'Debugging')
    expect(debugging).toHaveTextContent('Plugin is off')
    expect(within(debugging).queryByRole('button', { name: /^Remove/ })).toBeNull()
  })

  it('two owned skills, one flagged unable to merge, show no Merge, and the flagged one says why', () => {
    const flagged = entry('Deck Builder', { job: 'design.decks', noMerge: { reason: 'extra-files' } })
    const plain = entry('Slide Notes', { job: 'design.decks' })
    mount(scanOf([flagged, plain]))
    const decks = job(openSection('Design'), 'Decks')
    expect(within(decks).queryByRole('button', { name: /^Merge/ })).toBeNull()
    expect(decks).toHaveTextContent("Can't merge: it has files besides SKILL.md.")
  })

  it('names the file a secret sits in, and links outside the folder, as one-line reasons', () => {
    const secret = entry('Deploy Notes', { job: 'development.platforms', noBackup: { reason: 'secret', file: '.env.local' } })
    const linked = entry('Shared Rules', {
      job: 'development.specs',
      noBackup: { reason: 'links-outside' },
      noMerge: { reason: 'links-outside' },
    })
    mount(scanOf([secret, linked]))
    const sheet = openSection('Development')
    expect(job(sheet, 'Platforms')).toHaveTextContent('Not backed up: .env.local looks like it holds a secret.')
    expect(job(sheet, 'Specs')).toHaveTextContent('Not backed up or merged: it links to files outside its folder.')
  })

  it('shows copy counts on a skill one tool loads twice', () => {
    mount(scanOf([entry('Twice', { job: 'research.summaries', tools: [{ tool: 'claude-code', copies: 2 }] })]))
    expect(job(openSection('Research'), 'Summaries')).toHaveTextContent('Claude Code loads 2 copies')
  })

  it("points the person's own published skill to its page instead of the trash", () => {
    const own = entry('My Launch Kit', {
      job: 'marketing.launches',
      source: 'skillet-own',
      skillet: { ref: '@sample-maker/my-launch-kit', name: 'My Launch Kit' },
    })
    const { changes } = mount(scanOf([own]))
    const launches = job(openSection('Marketing'), 'Launches')
    fireEvent.click(within(launches).getByRole('button', { name: 'Remove My Launch Kit' }))
    expect(changes).not.toHaveBeenCalled()
    expect(within(launches).getByRole('link', { name: 'its page' })).toHaveAttribute('href', '/sample-maker/my-launch-kit')
  })
})

describe('the rest of the map', () => {
  it('lists unsorted skills under Not sorted, each with Move', () => {
    const loose = entry('Mystery Tool')
    const { latest } = mount(scanOf([loose]))
    const sheet = openSection('Not sorted')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move Mystery Tool' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Move Mystery Tool' })).getByRole('button', { name: 'Editing' }))
    expect(latest()).toEqual([{ kind: 'move', key: loose.key, job: 'writing.editing' }])
  })

  it('names every tool it read and what it could not check', () => {
    mount(
      scanOf(
        [entry('Plain Prose', { job: 'writing.editing' })],
        [
          { tool: 'claude-code', history: 'read' },
          { tool: 'codex', history: 'short' },
        ],
        [{ reason: 'project-plugin', tools: ['claude-code'], plugin: 'superpowers@obra' }],
      ),
    )
    expect(
      screen.getByText(/Looked in Claude Code and Codex\. Usage is unknown for Codex\. Couldn't check 1 place\./),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See why' }))
    const tray = screen.getByRole('dialog', { name: "Couldn't check" })
    expect(tray).toHaveTextContent('It keeps less than 30 days of history, so its skills have no unused mark.')
    expect(tray).toHaveTextContent('A plugin installed for one project')
    expect(tray).toHaveTextContent('superpowers@obra')
  })

  it('says once that picks are chosen by hand', () => {
    mount(scanOf([entry('Plain Prose', { job: 'writing.editing' })]))
    expect(screen.getAllByText("Picks are chosen by hand from Skillet's public skills.")).toHaveLength(1)
    openSection('Writing')
    expect(screen.getAllByText("Picks are chosen by hand from Skillet's public skills.")).toHaveLength(1)
  })

  it('draws no image and makes no request, with empty and filled jobs on screen', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mount(
      scanOf([
        entry('Plain Prose', { job: 'writing.editing' }),
        plugin('Code Review', 'compound-engineering', { job: 'development.code-review' }),
        entry('Mystery Tool'),
      ]),
    )
    for (const name of ['Writing', 'Development', 'Not sorted']) {
      openSection(name)
      fireEvent.keyDown(screen.getByRole('dialog', { name }), { key: 'Escape' })
    }
    openSection('Writing')
    expect(document.querySelectorAll('img, picture, image, source, video, iframe')).toHaveLength(0)
    expect(document.body.innerHTML).not.toMatch(/url\(/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lists every drafted change with its own Undo', () => {
    const a = entry('Plain Prose', { job: 'writing.editing' })
    const { latest } = mount(scanOf([a]))
    fireEvent.click(within(job(openSection('Writing'), 'Editing')).getByRole('button', { name: 'Remove Plain Prose' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Writing' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '1 change' }))
    const tray = screen.getByRole('dialog', { name: '1 change' })
    expect(tray).toHaveTextContent('Remove Plain Prose')
    fireEvent.click(within(tray).getByRole('button', { name: /^Undo/ }))
    expect(latest()).toEqual([])
  })

  it('the demo scan is a valid scan with every kind of mark in it', () => {
    expect(parseKitMapScan(DEMO_SCAN)).not.toBeNull()
    const sources = new Set(DEMO_SCAN.entries.map((e) => e.source))
    for (const source of ['local', 'plugin', 'skillet-added', 'skillet-own']) expect(sources.has(source as never), source).toBe(true)
    expect(DEMO_SCAN.entries.some((e) => e.usage.state === 'unused')).toBe(true)
    expect(DEMO_SCAN.entries.some((e) => e.job === null)).toBe(true)
  })
})

describe('frame states around Save', () => {
  const scan = () => scanOf([entry('Plain Prose', { job: 'writing.editing' }), entry('Copy Editor', { job: 'writing.editing' })])

  it('pressing Save hands off to the page', () => {
    const onSave = vi.fn()
    mount(scan(), { onSave })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('locks drafts while saving, and Save reopens the other tab', () => {
    const onReopen = vi.fn()
    mount(scan(), { save: { phase: 'opened' }, onReopen })
    fireEvent.click(screen.getByRole('button', { name: 'Finish in the other tab' }))
    expect(onReopen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    const editing = job(openSection('Writing'), 'Editing')
    expect(within(editing).getByRole('button', { name: /^Merge/ })).toBeDisabled()
    expect(within(editing).getByRole('button', { name: 'Remove Plain Prose' })).toBeDisabled()
    expect(within(editing).getByRole('button', { name: 'Move Plain Prose' })).toBeDisabled()
  })

  it('a blocked tab says so, with a retry', () => {
    const onReopen = vi.fn()
    mount(scan(), { save: { phase: 'blocked' }, onReopen })
    expect(screen.getByText('Your browser blocked the save tab.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onReopen).toHaveBeenCalledTimes(1)
  })

  it('a failed session start says so, with a retry that saves again', () => {
    const onSave = vi.fn()
    mount(scan(), { save: { phase: 'failed', started: false }, onSave })
    expect(screen.getByText("Save didn't start.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    // Drafts are open again.
    expect(within(job(openSection('Writing'), 'Editing')).getByRole('button', { name: /^Merge/ })).toBeEnabled()
  })

  it('status ended turns Save off and says to run the line again', () => {
    mount(scan(), { save: { phase: 'ended' } })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText(/npx -y skilletmd map/)).toBeInTheDocument()
    expect(within(job(openSection('Writing'), 'Editing')).getByRole('button', { name: /^Merge/ })).toBeDisabled()
  })

  it("a connected computer's progress and Done show in the frame", () => {
    mount(scan(), { save: { phase: 'progress', state: 'applying' } })
    expect(screen.getByRole('button', { name: 'Making changes…' })).toHaveAttribute('aria-disabled', 'true')
    cleanup()
    mount(scan(), { save: { phase: 'done' } })
    expect(screen.getByText(/Saved\. Backed up 2 skills\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get the app' })).toHaveAttribute('href', '/download')
  })
})
