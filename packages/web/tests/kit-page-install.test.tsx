import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KitPageContent } from '@/app/(consumer)/[author]/kit/[slug]/page'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT')
  },
  // The hero's Follow chip (FollowButton) calls useRouter for its optimistic refresh.
  useRouter: () => ({ refresh: () => {} }),
}))

// The hero's Follow chip reads the client session; stand in a logged-out one so
// it renders (as a sign-in Follow link) outside a SessionProvider.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

const mockGetKitByHandle = vi.fn()

vi.mock('@/lib/kits-server', () => ({
  getKitByHandle: (...args: unknown[]) => mockGetKitByHandle(...args),
  getKitVersions: vi.fn().mockResolvedValue({ kind: 'ok', versions: [] }),
  getRelatedKits: vi.fn().mockResolvedValue({ kind: 'ok', kits: [] }),
  getKitCapabilities: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/registry', () => ({
  // Doubles as the owner profile and, for a signed-in viewer, the connected
  // runtimes lookup — null means no client, which is the install-needed state.
  getAuthorProfile: vi.fn().mockResolvedValue(null),
}))

// Signed-in paths also reach the MCP lookup, which reads cookies() outside any
// request scope under the test renderer.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/session-cookie', () => ({
  readSessionCookie: () => null,
}))
vi.mock('@/lib/mcp-link', () => ({
  fetchMcpLink: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
}))

// Signed-in paths reach team lookups, which read cookies() outside any request
// scope under the test renderer.
vi.mock('@/lib/orgs-server', () => ({
  listMyOrgs: vi.fn().mockResolvedValue({ kind: 'unauthorized' }),
  getMutedTeamKitIds: vi.fn().mockResolvedValue(new Set<string>()),
}))

vi.mock('@/components/kits/subscribe-kit-button', () => ({
  SubscribeKitButton: () => <button type="button">Add</button>,
}))

const baseKit = {
  id: 'kit-1',
  owner: 'alice',
  slug: 'essentials',
  name: 'Essentials',
  description: 'A starter kit.',
  visibility: 'public' as const,
  created_at: 1_700_000_000,
  skills: [],
  subscriber_count: 3,
  subscribed: false,
}

async function renderKitPage(author = 'alice', slug = 'essentials') {
  const jsx = await KitPageContent({
    params: Promise.resolve({ author, slug }),
  })
  return render(jsx)
}

describe('KitPage: one decision, then the bar answers it', () => {
  beforeEach(async () => {
    mockGetKitByHandle.mockResolvedValue({ kind: 'ok', kit: baseKit })
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValue(null as never)
  })

  it('offers one button and nothing competing with it', async () => {
    await renderKitPage()

    // Copy prompt used to sit beside Add. A second button at the page's only
    // decision point competed with the one thing worth pressing.
    expect(screen.queryByRole('button', { name: /Copy/i })).toBeNull()
  })

  it('prints nothing under the buttons until one is pressed', async () => {
    // The prompt used to sit here as bare monospace with no container, which
    // read as debug output rather than as something to paste. It moved into the
    // bar, which only speaks when spoken to.
    await renderKitPage()

    expect(screen.queryByText(/skillet\.md\/@alice\/kit\/essentials\/summon/)).toBeNull()
    expect(screen.queryByText(/Copied\./)).toBeNull()
  })

  it('does not pitch install before the kit has been added', async () => {
    // Install is the second half of Add, not an alternative to it.
    await renderKitPage()

    expect(screen.queryByText('Get the Skillet app')).not.toBeInTheDocument()
  })

  it('offers all three ways in once the kit is added', async () => {
    mockGetKitByHandle.mockResolvedValue({ kind: 'ok', kit: { ...baseKit, subscribed: true } })
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValue({ handle: 'bob' } as never)

    await renderKitPage()

    // Three doors, not a bespoke app-or-npx pair: that pair silently drops the
    // one way in that installs nothing.
    expect(screen.getByRole('link', { name: /Mac app/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy the install command/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ChatGPT/i })).toBeInTheDocument()
  })

  it("drops the make-your-own prompt from someone else's kit page", async () => {
    await renderKitPage()

    expect(screen.queryByText('Make your own')).not.toBeInTheDocument()
    expect(screen.queryByText('Create a kit')).not.toBeInTheDocument()
  })
})
