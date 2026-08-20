import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchBox } from '@/components/search/search-box'
import type { SearchGroups } from '@/lib/registry'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const GROUPS: SearchGroups = {
  skills: [
    {
      type: 'skill',
      skill_id: 'thgsantos:commit-message',
      author: 'thgsantos',
      slug: 'commit-message',
      description: 'Generates atomic commit messages',
      install_count: 12,
      url: '/skills/thgsantos/commit-message',
      score: 1,
    },
  ],
  kits: [
    {
      type: 'kit',
      kit_id: 'kit-1',
      owner: 'thgsantos',
      name: 'essentials',
      description: 'Core kit',
      url: '/kits/kit-1',
      score: 0.9,
    },
  ],
  authors: [
    {
      type: 'author',
      username: 'thgsantos',
      name: 'Thiago Santos',
      avatar_url: null,
      url: '/thgsantos',
      score: 0.8,
    },
  ],
  teams: [
    {
      type: 'team',
      slug: 'skillet-core',
      name: 'Skillet Core',
      url: '/orgs/skillet-core',
      score: 0.7,
    },
  ],
}

function mockSearchFetch(groups: SearchGroups) {
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    json: async () => ({ query: 'co', groups }),
  })) as unknown as typeof fetch
  global.fetch = fetchMock
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

function type(value: string) {
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  return input
}

beforeEach(() => {
  push.mockClear()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UniversalSearch (SearchBox)', () => {
  it('renders grouped results in Skills→Kits→Users order, with teams merged into Users', async () => {
    mockSearchFetch(GROUPS)
    render(<SearchBox />)
    type('co')

    // Section headers appear; authors + teams are merged under a single "Users".
    expect(await screen.findByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Kits')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.queryByText('Teams')).not.toBeInTheDocument()

    // One option per result; team now sits inside the Users section.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    expect(screen.getByText('commit-message')).toBeInTheDocument()
    expect(screen.getByText('thgsantos/essentials')).toBeInTheDocument()
    expect(screen.getByText('Thiago Santos')).toBeInTheDocument() // author row
    expect(screen.getByText('Skillet Core')).toBeInTheDocument() // team row, under Users

    const skillRow = options[0]
    expect(skillRow).toHaveAttribute('href', '/skills/thgsantos/commit-message')
  })

  it('hits the authenticated registry proxy for the query', async () => {
    const fetchMock = mockSearchFetch(GROUPS)
    render(<SearchBox />)
    type('co')

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/registry/api/v1/search')
    expect(String(url)).toContain('q=co')
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('is keyboard navigable: ArrowDown highlights, Enter navigates to the result url', async () => {
    mockSearchFetch(GROUPS)
    render(<SearchBox />)
    const input = type('co')
    await screen.findByText('Skills')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/kits/kit-1')
  })

  it('Enter with no highlight submits to the full results view', async () => {
    mockSearchFetch(GROUPS)
    render(<SearchBox />)
    const input = type('co')
    await screen.findByText('Skills')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/search?q=co')
  })

  it('renders a no-results state when every group is empty', async () => {
    mockSearchFetch({ skills: [], kits: [], authors: [], teams: [] })
    render(<SearchBox />)
    type('zzz')

    expect(await screen.findByText(/no results for/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('Escape clears the query first, then closes', async () => {
    mockSearchFetch(GROUPS)
    render(<SearchBox />)
    const input = type('co') as HTMLInputElement
    await screen.findByText('Skills')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })

  it('shows a clear button when there is text, and clicking it empties the input', async () => {
    mockSearchFetch(GROUPS)
    render(<SearchBox />)
    const input = type('co') as HTMLInputElement
    const clear = await screen.findByLabelText('Clear search')

    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    expect(input.value).toBe('')
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument()
  })

  it('merges docs from the docs route into a Docs group, shown last', async () => {
    // Registry returns only skills; the web-local docs route supplies the docs.
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/search/docs')) {
        return {
          ok: true,
          json: async () => ({
            docs: [
              {
                type: 'doc',
                doc_id: 'get-started/publish',
                title: 'Publish a skill',
                section: 'Get started',
                snippet: 'How to publish a skill from the CLI.',
                url: '/docs/publish',
                score: 5,
              },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({ query: 'pub', groups: { skills: GROUPS.skills } }) }
    }) as unknown as typeof fetch

    render(<SearchBox />)
    type('pub')

    expect(await screen.findByText('Docs')).toBeInTheDocument()
    const docRow = screen.getByText('Publish a skill').closest('[role="option"]')
    expect(docRow).toHaveAttribute('href', '/docs/publish')

    // Docs is the last group, so its row is the last option.
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toBe(docRow)
  })
})
