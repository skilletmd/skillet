import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The agent-facing half of a profile.
 *
 * This is the representation the zero-count rule kept missing: the HTML header
 * stopped printing "0 followers" but the twin an agent actually reads still
 * announced it, which is the same argument-against-itself one layer down.
 */

let profile: Record<string, unknown> | null

vi.mock('@/lib/registry', () => ({
  getAuthorProfile: vi.fn(async () => profile),
  getSkill: vi.fn(async () => null),
  getSkillCatalog: vi.fn(async () => ({ skills: [] })),
}))
vi.mock('@/lib/skill-bundle-content', () => ({
  getSkillBundleSummary: vi.fn(async () => null),
}))
vi.mock('@/lib/blog', () => ({ getAllPosts: vi.fn(() => []), getPost: vi.fn(() => null) }))

function base(over: Record<string, unknown> = {}) {
  return {
    username: 'every',
    displayName: 'Every',
    bio: null,
    followers: 0,
    skills: [
      {
        author: 'every',
        slug: 'ce-plan',
        title: 'CE Plan',
        description: 'Create structured plans.',
        visibility: 'public',
      },
    ],
    ...over,
  }
}

async function render(handle = '/every') {
  const { renderMarkdown } = await import('@/lib/markdown-representation')
  return (await renderMarkdown(handle, { full: false }))?.body ?? ''
}

describe('profile Markdown twin', () => {
  beforeEach(() => {
    vi.resetModules()
    profile = base()
  })

  it('omits a zero follower count entirely', async () => {
    const body = await render()

    expect(body).toContain('# Every (@every)')
    expect(body).not.toContain('Followers:')
  })

  it('prints the count once there is one', async () => {
    profile = base({ followers: 42 })

    expect(await render()).toContain('- Followers: 42')
  })

  it('still lists the public skills an agent routes against', async () => {
    const body = await render()

    expect(body).toContain('CE Plan')
    expect(body).toContain('Create structured plans.')
  })

  it('leaves private skills out of the candidate list', async () => {
    profile = base({
      skills: [
        { author: 'every', slug: 'secret', title: 'Secret', description: 'x', visibility: 'private' },
      ],
    })

    const body = await render()

    expect(body).not.toContain('Secret')
    expect(body).toContain('_No public skills yet._')
  })
})
