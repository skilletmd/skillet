import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SkillSummaryCard } from '@/app/(consumer)/skills/skill-summary-card'
import { DirectorySearch } from '@/app/(consumer)/skills/directory-search'
import { DirectoryPagination } from '@/app/(consumer)/skills/directory-pagination'
import type { SkillSummary } from '@/lib/types'

const push = vi.fn()
let currentParams = ''

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/skills',
  useSearchParams: () => new URLSearchParams(currentParams),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    // Run transitions synchronously and report not-pending.
    useTransition: () => [false, (cb: () => void) => cb()] as const,
  }
})

const makeSummary = (
  overrides: Partial<SkillSummary> & { author: string; slug: string },
): SkillSummary => ({
  skill_id: `${overrides.author}:${overrides.slug}`,
  description: `Description for ${overrides.slug}`,
  latest_hash: 'abc123',
  install_count: 42,
  created_at: 1_700_000_000,
  signatureStatus: 'unverified',
  ...overrides,
})

beforeEach(() => {
  push.mockClear()
  currentParams = ''
})

describe('SkillSummaryCard', () => {
  it('renders slug, description, and formatted install count', () => {
    render(
      <SkillSummaryCard
        skill={makeSummary({ author: 'ada', slug: 'writing-voice', install_count: 1234 })}
      />,
    )
    expect(screen.getByText('Writing Voice')).toBeInTheDocument()
    expect(screen.getByText('Description for writing-voice')).toBeInTheDocument()
    // The unified md card shows the install base as social proof ("Used by N").
    expect(screen.getByText(/Used by 1.2K/)).toBeInTheDocument()
  })

  it('uses the singular install label for a count of 1', () => {
    render(<SkillSummaryCard skill={makeSummary({ author: 'ada', slug: 's', install_count: 1 })} />)
    expect(screen.getByText(/Used by 1$/)).toBeInTheDocument()
  })

  it('links to the skill detail page and the author profile', () => {
    render(<SkillSummaryCard skill={makeSummary({ author: 'taylor', slug: 'deploy-ritual' })} />)
    expect(screen.getByRole('link', { name: 'Deploy Ritual' })).toHaveAttribute(
      'href',
      '/taylor/deploy-ritual',
    )
    expect(screen.getByRole('link', { name: '@taylor' })).toHaveAttribute('href', '/taylor')
  })

  it('renders no description text when description is null', () => {
    render(<SkillSummaryCard skill={makeSummary({ author: 'a', slug: 's', description: null })} />)
    // The card omits the description paragraph entirely — no placeholder copy.
    expect(screen.queryByText(/no description provided/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Description for/)).not.toBeInTheDocument()
  })

  it('renders no description text when description is empty or whitespace', () => {
    const { rerender } = render(
      <SkillSummaryCard skill={makeSummary({ author: 'a', slug: 's', description: '' })} />,
    )
    expect(screen.queryByText(/no description provided/i)).not.toBeInTheDocument()
    rerender(
      <SkillSummaryCard skill={makeSummary({ author: 'a', slug: 's', description: '   ' })} />,
    )
    expect(screen.queryByText(/no description provided/i)).not.toBeInTheDocument()
  })

  it('formats large install counts with grouping separators', () => {
    render(
      <SkillSummaryCard
        skill={makeSummary({ author: 'a', slug: 's', install_count: 1_204_530 })}
      />,
    )
    expect(screen.getByText(/Used by 1.2M/)).toBeInTheDocument()
  })

  it('renders no security badge when the scan is pending or absent', () => {
    const { rerender } = render(
      <SkillSummaryCard skill={makeSummary({ author: 'a', slug: 's', scanStatus: 'pending' })} />,
    )
    expect(screen.queryByText('scanned')).not.toBeInTheDocument()
    expect(screen.queryByText(/signal/)).not.toBeInTheDocument()

    rerender(<SkillSummaryCard skill={makeSummary({ author: 'a', slug: 's' })} />)
    expect(screen.queryByText('scanned')).not.toBeInTheDocument()
  })
})

describe('DirectorySearch', () => {
  it('navigates with the q param on submit and drops offset', () => {
    currentParams = 'offset=48'
    render(<DirectorySearch initialQuery="" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deploy' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(push).toHaveBeenCalledWith('/skills?q=deploy')
  })

  it('clears the q param when the search is emptied', () => {
    currentParams = 'q=deploy'
    render(<DirectorySearch initialQuery="deploy" />)
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(push).toHaveBeenCalledWith('/skills')
  })
})

describe('DirectoryPagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<DirectoryPagination total={10} limit={24} offset={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('disables Previous on the first page and advances on Next', () => {
    render(<DirectoryPagination total={50} limit={24} offset={0} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(push).toHaveBeenCalledWith('/skills?offset=24')
  })

  it('disables Next on the last page and preserves the q param going back', () => {
    currentParams = 'q=deploy&offset=48'
    render(<DirectoryPagination total={50} limit={24} offset={48} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /previous/i }))
    expect(push).toHaveBeenCalledWith('/skills?q=deploy&offset=24')
  })
})
