import { describe, expect, it } from 'vitest'
import { buildIndex, findRepo, namedSkill, normalizeRepo, resolvePost } from '@/lib/signal-resolve.mjs'

// Every attribution bug this surface has had shipped invisibly and was caught by
// a human looking at one card: a mirror-holder credited for someone else's
// plugin, a post about an unrelated tool pointed at two strangers' skills, one
// person's words rendered under another's face. These fixtures pin the rules.

const skill = (author: string, slug: string, source_repo: string | null = null) => ({
  author,
  slug,
  source_repo,
})

// `taylor` holds our copy of Every's plugin — the mirror-holder case.
const CORPUS = [
  skill('taylor', 'ce-debug', 'everyinc/compound-engineering-plugin'),
  skill('taylor', 'ce-brainstorm', 'everyinc/compound-engineering-plugin'),
  skill('taylor', 'ce-strategy', 'everyinc/compound-engineering-plugin'),
  skill('emilkowalski', 'animate-expo', 'emilkowalski/skills'),
  skill('mattpocock', 'code-review', 'mattpocock/skills'),
  skill('sentry', 'code-review', 'getsentry/skills'),
  skill('jakubkrehel', 'explain-interface', 'jakubkrehel/skills'),
]

const index = buildIndex(CORPUS)

describe('normalizeRepo', () => {
  it('keeps a repo whose name ends in the .git character set', () => {
    // "hey-cli".replace(/[.git]+$/) style trimming yields "hey-cl", and a
    // truncated repo is a 404 import.
    expect(normalizeRepo('basecamp/hey-cli')).toBe('basecamp/hey-cli')
  })

  it('strips a real .git suffix', () => {
    expect(normalizeRepo('owner/repo.git')).toBe('owner/repo')
  })

  it('trims a trailing slash', () => {
    expect(normalizeRepo('owner/repo/')).toBe('owner/repo')
  })

  it('rejects a non-repository GitHub path', () => {
    expect(normalizeRepo('sponsors/someone')).toBeNull()
    expect(normalizeRepo('orgs/anthropics')).toBeNull()
  })

  it('rejects a bare owner with no repo', () => {
    expect(normalizeRepo('owner')).toBeNull()
  })
})

describe('findRepo', () => {
  it('reads a repo out of a deep link', () => {
    expect(findRepo('see github.com/emilkowalski/skills/tree/main/animate-expo')).toBe(
      'emilkowalski/skills',
    )
  })

  it('reads a repo out of an expanded URL when the text has none', () => {
    expect(findRepo('new skill, link below', ['https://github.com/mattpocock/skills'])).toBe(
      'mattpocock/skills',
    )
  })

  it('returns null when no repo is present', () => {
    expect(findRepo('just talking about skills')).toBeNull()
  })
})

describe('namedSkill', () => {
  it('reads a slash-command name', () => {
    expect(namedSkill('New skill: /animate-expo for native apps')).toBe('animate-expo')
  })

  it('ignores a t.co path, which matches the slash-command shape exactly', () => {
    expect(namedSkill('great skill https://t.co/iywiklizem')).toBeNull()
  })

  it('ignores generic words after a slash', () => {
    expect(namedSkill('read the /docs for this skill')).toBeNull()
  })
})

describe('resolvePost', () => {
  it('credits the repo owner, not the handle holding our mirror', () => {
    const out = resolvePost(
      { text: 'Compound Engineering got ~70% smaller. github.com/everyinc/compound-engineering-plugin' },
      index,
    )
    expect(out.match).toBe('collection')
    expect(out.collection?.repoOwner).toBe('everyinc')
    expect(out.collection?.count).toBe(3)
    // The registry handle is still carried so the chip can link somewhere real.
    expect(out.collection?.author).toBe('taylor')
  })

  it('resolves to the exact skill when the post names one in that repo', () => {
    const out = resolvePost(
      { text: 'New skill: /animate-expo — github.com/emilkowalski/skills' },
      index,
    )
    expect(out.match).toBe('named')
    expect(out.skills).toEqual([{ author: 'emilkowalski', slug: 'animate-expo' }])
  })

  it('refuses a slug two authors share rather than picking one', () => {
    const out = resolvePost({ text: 'you need a /code-review skill' }, index)
    expect(out.match).toBe('none')
    expect(out.skills).toEqual([])
  })

  it('resolves a uniquely owned slug with no repo link', () => {
    const out = resolvePost({ text: 'Introducing a new skill: /explain-interface' }, index)
    expect(out.match).toBe('named')
    expect(out.skills[0]).toEqual({ author: 'jakubkrehel', slug: 'explain-interface' })
  })

  it('keeps an unmatched repo so the card can offer Import', () => {
    const out = resolvePost(
      { text: 'open-sourcing /fuck-cancer github.com/petergyang/fuck-cancer' },
      index,
    )
    expect(out.match).toBe('none')
    expect(out.repo).toBe('petergyang/fuck-cancer')
    expect(out.unknownSkill).toBe('fuck-cancer')
  })

  it('returns none with no repo and no name', () => {
    const out = resolvePost({ text: 'skills are becoming a problem' }, index)
    expect(out).toMatchObject({ match: 'none', repo: null, unknownSkill: null })
  })

  it('ignores a corpus entry with no source_repo when matching by repo', () => {
    const bare = buildIndex([skill('someone', 'thing-one')])
    expect(resolvePost({ text: 'github.com/someone/thing' }, bare).match).toBe('none')
  })
})

describe('roundup posts', () => {
  const wide = buildIndex([
    skill('garrytan', 'ship', 'garrytan/gstack'),
    skill('garrytan', 'qa', 'garrytan/gstack'),
    skill('addyosmani', 'a11y-audit', 'addyosmani/agent-skills'),
  ])

  it('collects every carried repo, not just the first', () => {
    // One real roundup named 42 repos; attaching the first was both a miss and
    // an arbitrary pick.
    const out = resolvePost(
      {
        text: 'skills you should install: github.com/garrytan/gstack github.com/addyosmani/agent-skills github.com/cline/cline',
      },
      wide,
    )
    expect(out.match).toBe('roundup')
    expect(out.collections.map((c) => c.repoOwner).sort()).toEqual(['addyosmani', 'garrytan'])
    expect(out.repos).toHaveLength(3)
  })

  it('stays a plain collection when only one repo is carried', () => {
    const out = resolvePost({ text: 'nice work github.com/garrytan/gstack' }, wide)
    expect(out.match).toBe('collection')
    expect(out.collections).toHaveLength(1)
  })

  it('prefers an exact named skill over roundup handling', () => {
    const out = resolvePost(
      { text: '/a11y-audit is great — github.com/addyosmani/agent-skills github.com/garrytan/gstack' },
      wide,
    )
    expect(out.match).toBe('named')
    expect(out.skills[0]).toEqual({ author: 'addyosmani', slug: 'a11y-audit' })
  })

  it('dedupes the same repo referenced twice', () => {
    const out = resolvePost(
      { text: 'github.com/garrytan/gstack and again github.com/garrytan/gstack/tree/main' },
      wide,
    )
    expect(out.repos).toEqual(['garrytan/gstack'])
  })
})

describe('slash names in prose', () => {
  it('does not read a bracketed choice as a skill', () => {
    // `Tone: [casual/formal]` published a skill called `formal`.
    expect(namedSkill('Keep it short. Tone: [casual/formal]. No preamble.')).toBeNull()
  })

  it('does not read an npx repo argument as a skill', () => {
    expect(namedSkill('npx skills add ericzakariasson/scandinavian-design')).toBeNull()
  })

  it('still reads a real slash command', () => {
    expect(namedSkill('a skill people use a lot: /eli5 <topic>')).toBe('eli5')
  })
})
