import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillProposeForm } from '@/components/skill-propose-form'
import { ProposalSubmitError } from '@/lib/create-proposal'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

type BundleStub = Record<string, { enc: string; data: string }>
vi.mock('@/components/skill-files-editor', () => ({
  SkillFilesEditor: ({
    files,
    onChange,
  }: {
    files: BundleStub
    onChange: (files: BundleStub) => void
  }) => (
    <textarea
      aria-label="skill markdown"
      value={files['SKILL.md']?.data ?? ''}
      onChange={(e) => onChange({ ...files, 'SKILL.md': { enc: 'utf8', data: e.target.value } })}
    />
  ),
}))

vi.mock('@/lib/browser-signing-bind', () => ({
  bindBrowserSigningOnce: vi.fn().mockResolvedValue(undefined),
}))

const mockCheckProposeAccess = vi.fn()
const mockFetchSkillVersionBundle = vi.fn()
const mockCreateSkillProposal = vi.fn()
vi.mock('@/lib/create-proposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/create-proposal')>()
  return {
    ...actual,
    checkProposeAccess: (...args: unknown[]) => mockCheckProposeAccess(...args),
    fetchSkillVersionBundle: (...args: unknown[]) => mockFetchSkillVersionBundle(...args),
    createSkillProposal: (...args: unknown[]) => mockCreateSkillProposal(...args),
  }
})

const mockFetchSkillManifest = vi.fn()
vi.mock('@/lib/skill-studio-client', () => ({
  fetchSkillManifest: (...args: unknown[]) => mockFetchSkillManifest(...args),
}))

const mockSign = vi.fn()
vi.mock('@/lib/proposal-signing', () => ({
  signContentHashForProposal: (...args: unknown[]) => mockSign(...args),
}))

const BASE_FILES = {
  'SKILL.md': { enc: 'utf8' as const, data: '# Before\n' },
  'extra.txt': { enc: 'utf8' as const, data: 'keep me\n' },
}

beforeEach(() => {
  mockPush.mockReset()
  mockCheckProposeAccess.mockResolvedValue({ kind: 'allowed' })
  mockFetchSkillManifest.mockResolvedValue({ latest_hash: 'sha256:base' })
  mockFetchSkillVersionBundle.mockResolvedValue({
    kind: 'ok',
    version: { hash: 'sha256:base', files: BASE_FILES },
  })
  mockSign.mockResolvedValue({ alg: 'ed25519', key_id: 'k'.repeat(64), sig: 'c2ln' })
  mockCreateSkillProposal.mockResolvedValue({ proposal_id: 'prop-1' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SkillProposeForm', () => {
  it('shows 403 copy when propose access is denied', async () => {
    mockCheckProposeAccess.mockResolvedValue({ kind: 'denied' })
    render(<SkillProposeForm author="taylor" slug="deploy-ritual" sessionHandle="taylor" />)

    await waitFor(() => {
      expect(screen.getByText(/Only the skill owner or a same-kit teammate/i)).toBeInTheDocument()
    })
  })

  it('renders a graded diff preview when SKILL.md changes', async () => {
    render(<SkillProposeForm author="taylor" slug="deploy-ritual" sessionHandle="taylor" />)

    await waitFor(() => {
      expect(screen.getByLabelText('skill markdown')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('skill markdown'), {
      target: { value: '# After\n' },
    })

    // Single changed file: the shared FileDiff shows a count header and the
    // change directly (no per-file collapse row), marker-stripped.
    const preview = screen.getByText('Preview changes').closest('section') as HTMLElement
    expect(
      within(preview).getByText((_c, el) => el?.textContent === '1 file changed'),
    ).toBeInTheDocument()
    expect(within(preview).getByText('# After')).toBeInTheDocument()
    expect(within(preview).getByText('# Before')).toBeInTheDocument()
  })

  it('submits via createSkillProposal and preserves non-SKILL files', async () => {
    render(<SkillProposeForm author="taylor" slug="deploy-ritual" sessionHandle="taylor" />)

    await waitFor(() => {
      expect(screen.getByLabelText('skill markdown')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('skill markdown'), {
      target: { value: '# After\n' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Submit proposal' }))

    await waitFor(() => {
      expect(mockCreateSkillProposal).toHaveBeenCalledWith(
        'taylor',
        'deploy-ritual',
        expect.objectContaining({
          baseHash: 'sha256:base',
          files: expect.objectContaining({
            'SKILL.md': { enc: 'utf8', data: '# After\n' },
            'extra.txt': { enc: 'utf8', data: 'keep me\n' },
          }),
        }),
      )
    })

    expect(mockPush).toHaveBeenCalledWith(
      '/taylor/deploy-ritual?proposal=prop-1#proposed-changes',
    )
  })

  it('offers refresh when base_stale is returned', async () => {
    mockCreateSkillProposal.mockRejectedValue(
      new ProposalSubmitError('Stale base', { code: 'base_stale', status: 409 }),
    )

    render(<SkillProposeForm author="taylor" slug="deploy-ritual" sessionHandle="taylor" />)

    await waitFor(() => {
      expect(screen.getByLabelText('skill markdown')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('skill markdown'), {
      target: { value: '# After\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit proposal' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Refresh from latest version' }),
      ).toBeInTheDocument()
    })
  })
})
