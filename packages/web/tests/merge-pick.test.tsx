import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { parseKitMapMerge, type KitMapMerge, type KitMapMergeStatus } from '@skillet/protocol/kit-map'
import { MapMerges, mergedOnLeft, type MapMergeItem, type MergeComputer } from '@/components/map/merge-pick'
import { MergedFrom } from '@/components/skills/merged-from'

// The merges on /map (plan U15, KTD13 KTD14; R22 R23 R25, AE1 AE5): a status
// line for each, the blind pick (one round per original, sides shuffled, no
// side named until the tally), "Use merged" only for a merge that won more than
// half, and Publish in one tap. Every registry call is a mocked fetch.

const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`
const KEYS = [hash(1), hash(2), hash(3), hash(4)]
const MERGED = hash(50)
const NAMES: Record<string, string> = {
  [KEYS[0]]: 'Plain Prose',
  [KEYS[1]]: 'Copy Editor',
  [KEYS[2]]: 'Line Editor',
  [KEYS[3]]: 'Proofread',
}
const COMPUTERS: MergeComputer[] = [
  { id: 'dev-1', label: 'test-machine', app: true },
  { id: 'dev-2', label: 'test-machine-2', app: false },
]
const BRIEF = 'Tighten this note for a stranger: the meeting moved to Friday.'
// Samples say nothing about who wrote them, as a fair blind round needs.
const ROUNDS = KEYS.map((key, i) => ({
  key,
  merged: `Meeting moved to Friday, same time. (${i + 1}m)`,
  original: `Heads up: Friday now. (${i + 1}o)`,
}))

function merge(over: Partial<KitMapMerge> & { status: KitMapMergeStatus }): KitMapMerge {
  const record = { id: 'merge-ab12', device: 'dev-1', job: 'writing.editing', keys: KEYS, updatedAt: 1_790_000_000, ...over }
  // Every fixture is a record the registry would send.
  const parsed = parseKitMapMerge(JSON.parse(JSON.stringify(record)))
  expect(parsed, `fixture reads as a merge: ${record.status}`).not.toBeNull()
  return parsed!
}

const READY = merge({ status: 'ready', merged: MERGED, brief: BRIEF, rounds: ROUNDS })
const SKILL = {
  name: 'Editing',
  tools: ['claude-code', 'codex'],
  files: { 'SKILL.md': { enc: 'utf8' as const, data: '---\nname: Editing\ndescription: One editing skill.\n---\n\nEdit.\n' } },
}

const fetchMock = vi.fn()
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init?.method ?? 'GET') as string, body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() }) as unknown as Response

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(items: MapMergeItem[], handle: string | null = 'test-user') {
  return render(<MapMerges merges={items} names={NAMES} computers={COMPUTERS} handle={handle} />)
}

const row = (job: string) => screen.getByRole('listitem', { name: job })

/** Opens the pick and plays every round, picking the merged sample where `mergedWins[i]`. */
function play(mergedWins: boolean[]) {
  fireEvent.click(within(row('Editing')).getByRole('button', { name: 'Pick' }))
  const sheet = screen.getByRole('dialog')
  const seen: Array<{ left: string; right: string }> = []
  mergedWins.forEach((wins, i) => {
    expect(within(sheet).getByText(`Round ${i + 1} of ${ROUNDS.length}`)).toBeInTheDocument()
    const left = within(sheet).getByTestId('side-a').textContent ?? ''
    const right = within(sheet).getByTestId('side-b').textContent ?? ''
    seen.push({ left, right })
    const mergedIsLeft = left.includes(ROUNDS[i].merged)
    const pickLeft = wins === mergedIsLeft
    fireEvent.click(within(sheet).getByRole('button', { name: pickLeft ? 'A' : 'B' }))
  })
  return { sheet, seen }
}

describe('the status line for every merge', () => {
  it('renders every status, with the couldn’t-write reason and the waiting-for-the-computer line', () => {
    mount([
      { merge: merge({ id: 'm-wait', job: 'writing.short-posts', status: 'waiting' }) },
      { merge: merge({ id: 'm-writing', job: 'writing.docs', status: 'writing' }) },
      { merge: READY, skill: SKILL },
      { merge: merge({ id: 'm-failed', job: 'writing.emails', status: 'failed', reason: 'no-ai-tool' }) },
      { merge: merge({ id: 'm-picked', job: 'design.interfaces', status: 'picked', merged: MERGED }), skill: SKILL },
      { merge: merge({ id: 'm-later', job: 'business.meetings', device: 'dev-2', status: 'picked', merged: MERGED }), skill: SKILL },
      { merge: merge({ id: 'm-applied', job: 'development.code-review', status: 'applied', merged: MERGED }), skill: SKILL },
      { merge: merge({ id: 'm-stale', job: 'development.tests', status: 'out-of-date', reason: 'sources-changed', merged: MERGED }) },
    ])

    expect(row('Short posts')).toHaveTextContent('Waiting for test-machine to write it.')
    expect(row('Docs')).toHaveTextContent('test-machine is writing it with your AI tool.')
    expect(row('Editing')).toHaveTextContent('Ready to pick.')
    expect(within(row('Editing')).getByRole('button', { name: 'Pick' })).toBeInTheDocument()
    expect(row('Emails')).toHaveTextContent("Couldn't write it. Merging needs Claude Code or Codex on test-machine.")
    expect(row('Interfaces')).toHaveTextContent('Replacing 4 skills on test-machine. The app does it within seconds.')
    expect(row('Meetings')).toHaveTextContent(
      'Replacing 4 skills on test-machine-2. It happens the next time the line runs there and Save is pressed.',
    )
    expect(row('Code review')).toHaveTextContent('Editing replaced 4 skills.')
    expect(within(row('Code review')).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(row('Tests')).toHaveTextContent('Out of date: a skill changed after the merge was written. Merge again on your next map.')
    expect(screen.queryByText(/—/)).toBeNull()
  })

  it('draws nothing when there are no merges', () => {
    const { container } = mount([])
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the blind pick (KTD13)', () => {
  it('AE1: a merge that wins 3 of 4 offers "Use merged", states its effect first, and leaves a replace', async () => {
    mount([{ merge: READY, skill: SKILL }])
    const { sheet } = play([true, true, false, true])

    expect(within(sheet).getByText('Merged won 3 of 4.')).toBeInTheDocument()
    expect(sheet).toHaveTextContent(
      'Replaces 4 skills in Claude Code and Codex on test-machine. The originals go to the trash and can be restored. The app does it within seconds.',
    )
    expect(within(sheet).getByRole('button', { name: 'Keep originals' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(json(200, { merge: { ...JSON.parse(JSON.stringify(READY)), status: 'picked' } }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use merged' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls()).toEqual([
      {
        url: `/api/registry/api/v1/map-merges/${READY.id}/pick`,
        method: 'POST',
        body: { use: 'merged', won: [KEYS[0], KEYS[1], KEYS[3]] },
      },
    ])
    expect(row('Editing')).toHaveTextContent('Replacing 4 skills on test-machine.')
  })

  it('AE1: a merge that wins 2 of 4 offers only "Keep originals", which deletes the merged skill and keeps the four', async () => {
    mount([{ merge: READY, skill: SKILL }])
    const { sheet } = play([true, false, true, false])

    expect(within(sheet).getByText('Merged won 2 of 4.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Use merged' })).toBeNull()
    expect(sheet).toHaveTextContent(
      'It needs more than half the rounds to replace your skills, so they stay as they are. Keep originals deletes the merged skill.',
    )

    fetchMock.mockResolvedValueOnce(json(200, { merge: null }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep originals' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls()).toEqual([
      { url: `/api/registry/api/v1/map-merges/${READY.id}/pick`, method: 'POST', body: { use: 'originals', won: [KEYS[0], KEYS[2]] } },
    ])
    expect(screen.queryByRole('listitem', { name: 'Editing' })).toBeNull()
  })

  it('shuffles sides per round, shows each round its own merged sample, and names no side until the tally', () => {
    const sides = ROUNDS.map((_, i) => mergedOnLeft(READY, i))
    expect(new Set(sides).size, 'the merged sample sits on both sides across rounds').toBe(2)

    mount([{ merge: READY, skill: SKILL }])
    fireEvent.click(within(row('Editing')).getByRole('button', { name: 'Pick' }))
    const sheet = screen.getByRole('dialog')
    const shown: string[] = []
    ROUNDS.forEach((round, i) => {
      const a = within(sheet).getByTestId('side-a').textContent ?? ''
      const b = within(sheet).getByTestId('side-b').textContent ?? ''
      expect(sides[i] ? a : b).toContain(round.merged)
      expect(sides[i] ? b : a).toContain(round.original)
      shown.push(sides[i] ? a : b)
      // Blind: no side is named, and nothing says what was picked.
      for (const name of [...Object.values(NAMES), 'Merged', 'merged skill', 'You picked', 'original']) {
        expect(sheet.textContent, `round ${i + 1} names "${name}"`).not.toContain(name)
      }
      fireEvent.click(within(sheet).getByRole('button', { name: 'A' }))
    })
    expect(new Set(shown).size, 'no merged sample repeats').toBe(ROUNDS.length)
    // The tally names the sides.
    expect(sheet).toHaveTextContent(/Merged (beat|won)/)
    for (const name of Object.values(NAMES)) expect(sheet).toHaveTextContent(name)
  })

  it('picks with the arrow keys, like the arena', () => {
    mount([{ merge: READY, skill: SKILL }])
    fireEvent.click(within(row('Editing')).getByRole('button', { name: 'Pick' }))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText(`Round 2 of ${ROUNDS.length}`)).toBeInTheDocument()
  })
})

describe('Publish (R25, KTD14)', () => {
  const applied = merge({ status: 'applied', merged: MERGED })

  it('AE5: takes one tap, with no license check or form, and links the new public skill', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/skills/test-user/editing') && !init?.method) return json(404, { error: 'not_found' })
      if (String(url) === '/api/registry/api/v1/skills' && init?.method === 'POST') return json(201, { hash: MERGED })
      return json(500, {})
    })
    mount([{ merge: applied, skill: SKILL }])

    fireEvent.click(within(row('Editing')).getByRole('button', { name: 'Publish' }))

    const link = await within(row('Editing')).findByRole('link', { name: '@test-user/editing' })
    expect(link).toHaveAttribute('href', '/test-user/editing')
    const post = calls().find((c) => c.method === 'POST')
    expect(post?.body).toEqual({
      author: 'test-user',
      slug: 'editing',
      files: SKILL.files,
      base_hash: null,
      publish_auth: 'session',
      visibility: 'public',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a slug the person already uses gets a number, and the old skill is never touched', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/skills/test-user/editing') && !init?.method) return json(200, { slug: 'editing' })
      if (String(url).endsWith('/skills/test-user/editing-2') && !init?.method) return json(404, { error: 'not_found' })
      if (String(url) === '/api/registry/api/v1/skills' && init?.method === 'POST') return json(201, { hash: MERGED })
      return json(500, {})
    })
    mount([{ merge: applied, skill: SKILL }])

    fireEvent.click(within(row('Editing')).getByRole('button', { name: 'Publish' }))

    expect(await within(row('Editing')).findByRole('link', { name: '@test-user/editing-2' })).toHaveAttribute('href', '/test-user/editing-2')
    const writes = calls().filter((c) => c.method !== 'GET')
    expect(writes).toHaveLength(1)
    expect(writes[0].body.slug).toBe('editing-2')
  })

  it('a merged skill already published links its page instead of offering Publish again', () => {
    mount([{ merge: merge({ status: 'applied', merged: MERGED, published: '@test-user/editing' }), skill: SKILL }])
    expect(within(row('Editing')).queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(within(row('Editing')).getByRole('link', { name: '@test-user/editing' })).toHaveAttribute('href', '/test-user/editing')
  })
})

describe('the public page lists a merged skill’s sources (R23)', () => {
  it('AE5: names the two public sources with their makers and links, and counts "1 private skill"', () => {
    render(
      <MergedFrom
        from={{
          sources: [
            { ref: '@every/house-style', name: 'House Style' },
            { ref: '@maker-one/tidy-notes', name: 'tidy-notes' },
          ],
          privateCount: 1,
        }}
      />,
    )
    expect(screen.getByRole('link', { name: 'House Style' })).toHaveAttribute('href', '/every/house-style')
    expect(screen.getByRole('link', { name: 'tidy-notes' })).toHaveAttribute('href', '/maker-one/tidy-notes')
    expect(screen.getByText('@every')).toBeInTheDocument()
    expect(screen.getByText('@maker-one')).toBeInTheDocument()
    expect(screen.getByText('1 private skill')).toBeInTheDocument()
  })

  it('maps the registry’s merged_from onto the skill the page renders', async () => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_REGISTRY_URL = 'https://registry.example.com'
    try {
      fetchMock.mockResolvedValue(
        json(200, {
          author: 'test-user',
          slug: 'editing',
          skill_id: 'test-user:editing',
          description: 'One editing skill.',
          visibility: 'public',
          latest_hash: MERGED,
          install_count: 0,
          created_at: 1_790_000_000,
          signatureStatus: 'verified',
          author_name: 'Test User',
          author_avatar_url: null,
          author_key_id: null,
          author_public_key: null,
          manifest_url: '/api/v1/skills/test-user/editing/manifest',
          merged_from: { sources: [{ ref: '@every/house-style', name: 'House Style' }], private: 2 },
        }),
      )
      const { getSkill } = await import('@/lib/registry')
      const skill = await getSkill('test-user', 'editing', { skipScan: true })
      expect(skill?.mergedFrom).toEqual({ sources: [{ ref: '@every/house-style', name: 'House Style' }], privateCount: 2 })
    } finally {
      delete process.env.NEXT_PUBLIC_REGISTRY_URL
    }
  })
})
