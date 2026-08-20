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
  getAuthorProfile: vi.fn().mockResolvedValue(null),
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

describe('KitPage install command', () => {
  beforeEach(() => {
    mockGetKitByHandle.mockResolvedValue({ kind: 'ok', kit: baseKit })
  })

  it('shows the npx kit install command', async () => {
    await renderKitPage()
    const matches = screen.getAllByText((_content, el) =>
      Boolean(el?.textContent?.includes('npx skilletmd add kit @alice/essentials -y')),
    )
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows the install panel for logged-out visitors', async () => {
    await renderKitPage()
    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.getByText('Get the Skillet app')).toBeInTheDocument()
  })
})
