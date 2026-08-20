import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SkillAuthenticatedResolve } from '@/components/skills/skill-authenticated-resolve'

// The session-gated fallback: after the public + session getSkill both come back
// null, it renders a tombstone when the skill was deprecated (registry 410) and
// only 404s when the skill is genuinely gone. The owner path (getSkill returns a
// skill) must never touch the tombstone fetch.

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockGetSkill = vi.fn()
const mockGetSkillTombstone = vi.fn()

vi.mock('@/lib/registry', () => ({
  getSkill: (...a: unknown[]) => mockGetSkill(...a),
  getSkillTombstone: (...a: unknown[]) => mockGetSkillTombstone(...a),
  getKitsForSkill: vi.fn().mockResolvedValue([]),
  getAuthorProfile: vi.fn().mockResolvedValue(null),
  getSkillCatalog: vi.fn().mockResolvedValue({ skills: [], total: 0, limit: 8, offset: 0 }),
}))

vi.mock('@/lib/skill-bundle-content', () => ({
  getSkillBundleSummary: vi.fn().mockResolvedValue(null),
}))

// Stub the heavy page view so the owner-path test stays focused on routing.
vi.mock('@/components/skills/skill-page-view', () => ({
  SkillPageView: () => <div data-testid="skill-page-view">page</div>,
}))

beforeEach(() => {
  mockGetSkill.mockReset()
  mockGetSkillTombstone.mockReset()
})

async function renderResolve() {
  const jsx = await SkillAuthenticatedResolve({ author: 'alice', slug: 'sunset' })
  return render(jsx)
}

describe('SkillAuthenticatedResolve — tombstone fallback', () => {
  it('renders the tombstone (not a 404) when the skill was deprecated', async () => {
    mockGetSkill.mockResolvedValue(null)
    mockGetSkillTombstone.mockResolvedValue({
      message: 'Moved to alice/sunset-v2.',
      deprecatedAt: '2026-06-01T00:00:00Z',
    })
    await renderResolve()
    expect(screen.getByText('Deprecated')).toBeInTheDocument()
    expect(screen.getByText('Moved to alice/sunset-v2.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '@alice' })).toHaveAttribute('href', '/alice')
  })

  it('calls notFound() when the skill is genuinely gone (no tombstone)', async () => {
    mockGetSkill.mockResolvedValue(null)
    mockGetSkillTombstone.mockResolvedValue(null)
    await expect(renderResolve()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the page and never fetches a tombstone on the owner path', async () => {
    mockGetSkill.mockResolvedValue({ author: 'alice', slug: 'sunset', deprecated: true })
    await renderResolve()
    expect(screen.getByTestId('skill-page-view')).toBeInTheDocument()
    expect(mockGetSkillTombstone).not.toHaveBeenCalled()
  })
})
