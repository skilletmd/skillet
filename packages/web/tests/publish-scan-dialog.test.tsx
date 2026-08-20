import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillStudioEditor } from '@/components/skill-studio-editor'
import type { ScanDraftResult } from '@/lib/skill-studio-client'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

type BundleStub = Record<string, { enc: string; data: string }>
vi.mock('@/components/skill-files-editor', () => ({
  SkillFilesEditor: ({
    files,
    footer,
    onChange,
  }: {
    files: BundleStub
    footer?: React.ReactNode
    onChange: (f: BundleStub) => void
  }) => (
    <div>
      <textarea
        aria-label="skill markdown"
        value={files['SKILL.md']?.data ?? ''}
        onChange={(e) => onChange({ ...files, 'SKILL.md': { enc: 'utf8', data: e.target.value } })}
      />
      {footer}
    </div>
  ),
}))

const mockScanDraft = vi.fn<(files: unknown) => Promise<ScanDraftResult>>()
const mockPublish = vi.fn().mockResolvedValue({ hash: 'sha256:x', skill_id: 'alice:my-skill' })
const mockWhoami = vi.fn().mockResolvedValue({ handle: 'alice', author_key_id: 'k1' })
vi.mock('@/lib/skill-studio-client', () => ({
  PUBLISH_AUTH_SESSION: 'session',
  fetchWhoami: (...a: unknown[]) => mockWhoami(...a),
  scanDraft: (...a: unknown[]) => mockScanDraft(...(a as [unknown])),
  publishSkillFromBrowser: (...a: unknown[]) => mockPublish(...a),
}))

const VALID_MD = '---\nname: My Skill\ndescription: A skill\n---\n\n## When to use\n\nUse it.\n'

function renderEditor(visibility: 'private' | 'public' = 'public') {
  return render(
    <SkillStudioEditor
      mode="create"
      author="alice"
      sessionHandle="alice"
      initialMarkdown={VALID_MD}
      initialVisibility={visibility}
    />,
  )
}

const flaggedVerdict: ScanDraftResult = {
  status: 'flagged',
  findings: [
    {
      category: 'network-egress',
      confidence: 'low',
      file: 'SKILL.md',
      lineStart: 7,
      lineEnd: 7,
      why: 'Reaches an external URL.',
      snippet: 'curl https://example.com',
    },
  ],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('publish-step scan findings panel', () => {
  it('a clean verdict publishes with no panel', async () => {
    mockScanDraft.mockResolvedValue({ status: 'clean', findings: [] })
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Before you publish/)).not.toBeInTheDocument()
  })

  it('AE1: a secret verdict blocks publish — fix-list rail, no confirm, no publish call', async () => {
    mockScanDraft.mockResolvedValue({
      status: 'quarantined',
      reason: 'secret',
      findings: [
        { category: 'secret', confidence: 'high', file: 'scripts/setup.sh', lineStart: 1, lineEnd: 1, why: 'Credential.' },
      ],
    })
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Publish blocked')).toBeInTheDocument()
    // Blocked → no action buttons in the rail (it re-scans live as you edit);
    // no fake-escape Close, no in-rail Publish, and nothing publishes.
    const panel = within(screen.getByRole('complementary'))
    expect(
      panel.queryByRole('button', { name: /Republish|^Publish$|Close|Cancel|Re-check/ }),
    ).not.toBeInTheDocument()
    expect(panel.getByText(/Fixes update automatically/)).toBeInTheDocument()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('AE2: first Publish reveals the warnings; a second ships with the note', async () => {
    mockScanDraft.mockResolvedValue(flaggedVerdict)
    renderEditor('public')

    // First Publish opens the "worth a look" rail — it doesn't ship yet.
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Before you publish')).toBeInTheDocument()
    expect(screen.getByText('1 flag has no note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /SKILL\.md:7/ })).toBeInTheDocument()
    expect(mockPublish).not.toHaveBeenCalled()

    // Add a note, then the second Publish ships it (single button, no Cancel).
    const input = screen.getByPlaceholderText('Why is this OK? (optional)')
    fireEvent.change(input, { target: { value: 'Fetches a public word list — read only.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1))
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      harmNotes: { 'network-egress:SKILL.md:7': 'Fetches a public word list — read only.' },
    })
  })

  it('blocked → editing live-clears the rail when the next scan is clean (no re-check)', async () => {
    mockScanDraft.mockResolvedValueOnce({
      status: 'quarantined',
      reason: 'secret',
      findings: [
        { category: 'secret', confidence: 'high', file: 'SKILL.md', lineStart: 9, lineEnd: 9, why: 'Credential.' },
      ],
    })
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await screen.findByText('Publish blocked')

    // Edit the file; the debounced live scan re-runs and now comes back clean,
    // so the rail closes itself — no manual re-check.
    mockScanDraft.mockResolvedValue({ status: 'clean', findings: [] })
    fireEvent.change(screen.getByLabelText('skill markdown'), {
      target: { value: VALID_MD + '\nfixed\n' },
    })
    await waitFor(() => expect(screen.queryByText('Publish blocked')).not.toBeInTheDocument(), {
      timeout: 2500,
    })
  })

  it('a secret on a KEY=value line offers a one-click placeholder fix', async () => {
    const md = VALID_MD + '\nAWS_ACCESS_KEY_ID=AKIA2RZ7K4Q3PN5T6XW9\n' // secret on line 10
    mockScanDraft.mockResolvedValue({
      status: 'quarantined',
      reason: 'secret',
      findings: [
        { category: 'secret', confidence: 'high', file: 'SKILL.md', lineStart: 10, lineEnd: 10, why: 'Credential.' },
      ],
    })
    render(
      <SkillStudioEditor
        mode="create"
        author="alice"
        sessionHandle="alice"
        initialMarkdown={md}
        initialVisibility="public"
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await screen.findByText('Publish blocked')

    fireEvent.click(await screen.findByRole('button', { name: 'Replace with placeholder' }))

    const ta = screen.getByLabelText('skill markdown') as HTMLTextAreaElement
    expect(ta.value).toContain('AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID')
    expect(ta.value).not.toContain('AKIA2RZ7K4Q3PN5T6XW9')
  })

  it('a private flagged publish shows no note inputs (notes are public-only)', async () => {
    mockScanDraft.mockResolvedValue(flaggedVerdict)
    renderEditor('private')
    // A private skill's primary action reads "Save" (public reads "Publish").
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Before you publish')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Why is this OK? (optional)')).not.toBeInTheDocument()
  })
})
