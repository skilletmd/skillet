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

describe('KitPage delivery is gated on adding, not offered beside it', () => {
  beforeEach(async () => {
    mockGetKitByHandle.mockResolvedValue({ kind: 'ok', kit: baseKit })
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValue(null as never)
  })

  it('offers a logged-out visitor something to do that costs nothing', async () => {
    await renderKitPage()

    expect(screen.getByText('Try it now, nothing installed')).toBeInTheDocument()
    const summon = screen.getAllByText((_c, el) =>
      Boolean(el?.textContent?.includes('skillet.md/@alice/kit/essentials/summon')),
    )
    expect(summon.length).toBeGreaterThan(0)
  })

  it('does not pitch install before the kit has been added', async () => {
    // Install is the second half of Add kit, not an alternative to it. Shown
    // side by side it made one decision look like three, and it asked a visitor
    // who had committed to nothing to install a CLI.
    await renderKitPage()

    expect(screen.queryByText('Install')).not.toBeInTheDocument()
    expect(screen.queryByText('Get the Skillet app')).not.toBeInTheDocument()
  })

  it('offers both install paths once the kit is added and no client is connected', async () => {
    mockGetKitByHandle.mockResolvedValue({
      kind: 'ok',
      kit: { ...baseKit, subscribed: true },
    })
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValue({ handle: 'bob' } as never)

    await renderKitPage()

    expect(screen.getByText('Get the Skillet app')).toBeInTheDocument()
    const matches = screen.getAllByText((_c, el) =>
      Boolean(el?.textContent?.includes('npx skilletmd add kit @alice/essentials -y')),
    )
    expect(matches.length).toBeGreaterThan(0)
  })

  it('drops the make-your-own prompt from someone else\u2019s kit page', async () => {
    // A supply call to action on a demand page, competing with the one decision
    // the page is asking for.
    await renderKitPage()

    expect(screen.queryByText('Make your own')).not.toBeInTheDocument()
    expect(screen.queryByText('Create a kit')).not.toBeInTheDocument()
  })
})
