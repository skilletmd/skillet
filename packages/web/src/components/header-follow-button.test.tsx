import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeaderFollowButton } from './header-follow-button'

// The chip reads the viewer from the client session; drive that per test.
const useSession = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSession() }))
// FollowButton pulls in the router for its optimistic refresh — stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function session(state: 'loading' | 'authenticated' | 'unauthenticated', handle?: string) {
  useSession.mockReturnValue({
    status: state,
    data: state === 'authenticated' ? { handle } : null,
  })
}

beforeEach(() => useSession.mockReset())

describe('HeaderFollowButton', () => {
  it('renders a Follow control for a signed-in visitor who is not the owner', () => {
    session('authenticated', 'bob')
    render(<HeaderFollowButton owner="thiago" />)
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
  })

  it('hides for a logged-out visitor (the hero asks one question: Add)', () => {
    session('unauthenticated')
    const { container } = render(<HeaderFollowButton owner="thiago" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides on your own object (you cannot follow yourself)', () => {
    session('authenticated', 'thiago')
    const { container } = render(<HeaderFollowButton owner="thiago" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides while the session is still resolving (no flash on an owner page)', () => {
    session('loading')
    const { container } = render(<HeaderFollowButton owner="thiago" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides for team-owned objects (teams are not followable)', () => {
    session('authenticated', 'bob')
    const { container } = render(<HeaderFollowButton owner="acme" isTeam />)
    expect(container).toBeEmptyDOMElement()
  })
})
