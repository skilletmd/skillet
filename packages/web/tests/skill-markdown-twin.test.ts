import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Markdown twin of a skill page.
 *
 * The bug this file exists to prevent coming back: SKILL.md is an index as
 * often as it is the whole instruction set — the format has it say "read
 * `references/cli.md`" and load that only when the task needs it. Serving the
 * body alone handed an agent instructions whose pointers went nowhere.
 */

const SKILL_BODY = [
  '# loops-cli',
  '',
  'Do the thing.',
  '',
  '## Category Routing',
  '',
  '- Installation and auth flows: Read `references/cli.md`',
].join('\n')

const HASH = 'sha256:' + 'c'.repeat(64)

let skill: Record<string, unknown> | null
let bundle: Record<string, unknown> | null
let fileBodies: Record<string, string>
let fileFetches: string[]

vi.mock('@/lib/registry', () => ({
  getSkill: vi.fn(async () => skill),
  getAuthorProfile: vi.fn(async () => null),
  getSkillCatalog: vi.fn(async () => ({ skills: [] })),
}))

vi.mock('@/lib/skill-bundle-content', () => ({
  getSkillBundleSummary: vi.fn(async () => bundle),
  fetchSkillBundleFile: vi.fn(async (_a: string, _s: string, _h: string, path: string) => {
    fileFetches.push(path)
    const text = fileBodies[path]
    return text === undefined ? null : { path, kind: 'text', size: text.length, text }
  }),
}))

const render = async (path: string, options?: { full?: boolean }) => {
  const { renderMarkdown } = await import('@/lib/markdown-representation')
  const out = await renderMarkdown(path, options)
  return out?.body ?? ''
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://skillet.md'
  fileFetches = []
  fileBodies = { 'references/cli.md': '# CLI reference\n\nEvery flag, listed.' }
  skill = {
    author: 'loops',
    slug: 'loops-cli',
    title: 'Loops CLI',
    description: 'Work with the Loops CLI.',
    category: 'backend',
    latestVersion: 'v1.0.0',
    installCount: 0,
    versions: [],
    tokenCount: 664,
    mirrorSourceUrl: 'https://github.com/loops-so/skills',
    mirrorLicense: 'MIT',
    capabilities: [{ capability: 'runs-shell' }, { capability: 'network' }],
    capabilitiesAnalysis: 'full',
    publishedAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  }
  bundle = {
    versionHash: HASH,
    skillMdBody: SKILL_BODY,
    frontmatter: null,
    files: [
      { path: 'SKILL.md', kind: 'text', size: SKILL_BODY.length, executable: false },
      { path: 'references/cli.md', kind: 'text', size: 42, executable: false },
      { path: 'assets/logo.png', kind: 'binary', size: 9000, executable: false },
    ],
  }
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  vi.clearAllMocks()
})

/** Push the bundle over the auto-inline threshold (50 KB). */
function makeLarge() {
  bundle!.files = [
    { path: 'SKILL.md', kind: 'text', size: SKILL_BODY.length, executable: false },
    { path: 'references/cli.md', kind: 'text', size: 80_000, executable: false },
  ]
}

describe('default representation', () => {
  it('still serves the SKILL.md body verbatim', async () => {
    const md = await render('/loops/loops-cli')
    expect(md).toContain('## SKILL.md')
    expect(md).toContain('Read `references/cli.md`')
  })

  // The whole point: the pointer in the body now resolves.
  it('gives every non-entrypoint file a fetchable URL', async () => {
    const md = await render('/loops/loops-cli')
    expect(md).toContain('## Files')
    expect(md).toContain(
      `https://skillet.md/api/v1/skills/loops/loops-cli/versions/${encodeURIComponent(HASH)}/file?path=references%2Fcli.md`,
    )
    expect(md).toContain('assets/logo.png')
    expect(md).toMatch(/binary/)
  })

  it('does not list SKILL.md as something to fetch — it is already inline', async () => {
    const md = await render('/loops/loops-cli')
    const files = md.split('## Files')[1]!.split('## SKILL.md')[0]!
    expect(files).toContain('included below')
    expect(files).not.toContain('path=SKILL.md')
  })

  // 88% of the live catalog fits under the threshold. Making those pay a round
  // trip to save ~12k tokens is the bad trade the old link-only default made.
  it('inlines a small bundle by default, and says it did', async () => {
    const md = await render('/loops/loops-cli')
    expect(md).toContain('## references/cli.md')
    expect(md).toContain('Every flag, listed.')
    expect(md).toContain('nothing here needs fetching')
    expect(fileFetches).toEqual(['references/cli.md'])
  })

  // The tail is real: p99 of the catalog is 1.2 MB, the max 1.8 MB.
  it('links a bundle over the threshold instead of inlining it', async () => {
    makeLarge()
    const md = await render('/loops/loops-cli')
    expect(fileFetches).toEqual([])
    expect(md).not.toContain('Every flag, listed.')
    expect(md).toContain('over the 50 KB inline threshold')
    expect(md).toContain('?full=1')
  })

  // A reader that is not told which mode it got cannot tell "no more content"
  // from "the rest is behind those links".
  it('always states which mode the response is in', async () => {
    expect(await render('/loops/loops-cli')).toMatch(/inlined below/)
    makeLarge()
    expect(await render('/loops/loops-cli')).toMatch(/linked instead/)
  })

  // A link inside a Markdown document reads like it returns Markdown. It does
  // not — an agent that assumes so parses a JSON envelope as prose.
  it('says the file URLs answer JSON, not raw bytes', async () => {
    const md = await render('/loops/loops-cli')
    expect(md).toContain('Each URL returns JSON')
    expect(md).toContain('`text` field')
  })

  it('states what the skill is allowed to do', async () => {
    const md = await render('/loops/loops-cli')
    const section = md.split('## Permissions')[1]!.split('##')[0]!
    expect(section).toContain('Run commands')
    expect(section).toContain('Use the internet')
  })

  it('carries the provenance an agent needs to judge and budget', async () => {
    const md = await render('/loops/loops-cli')
    expect(md).toContain(`- Version hash: ${HASH}`)
    expect(md).toContain('- Size: ~664 tokens')
    expect(md).toContain('https://github.com/loops-so/skills (MIT)')
    expect(md).toContain('- Updated: 2026-08-21')
  })
})

describe('?full=1 and ?full=0', () => {
  it('inlines a large bundle when explicitly asked', async () => {
    makeLarge()
    const md = await render('/loops/loops-cli', { full: true })
    expect(md).toContain('## references/cli.md')
    expect(md).toContain('Every flag, listed.')
    expect(fileFetches).toEqual(['references/cli.md'])
  })

  it('links a small bundle when explicitly told not to inline', async () => {
    const md = await render('/loops/loops-cli', { full: false })
    expect(fileFetches).toEqual([])
    expect(md).not.toContain('Every flag, listed.')
    expect(md).toContain('`?full=0` was set')
  })

  it('inlines every text file under its own heading', async () => {
    const md = await render('/loops/loops-cli', { full: true })
    expect(md).toContain('## references/cli.md')
    expect(md).toContain('Every flag, listed.')
    expect(fileFetches).toEqual(['references/cli.md'])
  })

  // A truncated response that does not say so is worse than a short one.
  it('names what it could not inline instead of dropping it silently', async () => {
    const md = await render('/loops/loops-cli', { full: true })
    const section = md.split('## Not inlined')[1] ?? ''
    expect(section).toContain('assets/logo.png')
    expect(section).toContain('binary')
  })

  it('stops at the byte budget and says which files it skipped', async () => {
    bundle!.files = [
      { path: 'SKILL.md', kind: 'text', size: 10, executable: false },
      { path: 'references/huge.md', kind: 'text', size: 900_000, executable: false },
    ]
    fileBodies['references/huge.md'] = 'x'.repeat(100)
    const md = await render('/loops/loops-cli', { full: true })
    expect(fileFetches).toEqual([])
    expect(md).toContain('over the inline budget')
  })

  it('reports an unreadable file rather than pretending it was empty', async () => {
    fileBodies = {}
    const md = await render('/loops/loops-cli', { full: true })
    expect(md).toContain('unreadable')
  })
})

describe('degraded inputs', () => {
  it('answers with the catalog record when the bundle is unreachable', async () => {
    bundle = null
    const md = await render('/loops/loops-cli')
    expect(md).toContain('# Loops CLI (@loops)')
    expect(md).not.toContain('## SKILL.md')
  })

  it('404s when the skill does not exist', async () => {
    skill = null
    expect(await render('/loops/loops-cli')).toBe('')
  })

  // Four capability states, and two of them are NOT "no permissions".
  it('distinguishes never-analyzed from analyzed-and-clean', async () => {
    skill!.capabilities = null
    expect(await render('/loops/loops-cli')).toContain('Not analyzed for this version')

    skill!.capabilities = []
    skill!.capabilitiesAnalysis = 'full'
    expect(await render('/loops/loops-cli')).toContain('None detected. Everything executable')

    skill!.capabilitiesAnalysis = 'partial'
    expect(await render('/loops/loops-cli')).toContain('Not a proof of inertness')
  })

  it('omits the section entirely when the scan was never fetched', async () => {
    delete skill!.capabilities
    expect(await render('/loops/loops-cli')).not.toContain('## Permissions')
  })
})
