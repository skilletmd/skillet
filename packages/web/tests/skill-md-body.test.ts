import { describe, it, expect } from 'vitest'
import { splitSkillMdFrontmatter } from '@/lib/skill-md-body'
import { skillMarkdownMetadata, slugifySkillName } from '@/lib/skill-md-metadata'

describe('splitSkillMdFrontmatter', () => {
  it('splits YAML frontmatter from the markdown body', () => {
    const md = `---
name: clima-rs-tche
description: Weather for RS.
---

# Clima do RS

Body here.`

    const result = splitSkillMdFrontmatter(md)
    expect(result.frontmatter).toContain('name: clima-rs-tche')
    expect(result.body).toBe('# Clima do RS\n\nBody here.')
  })

  it('returns the full string as body when there is no frontmatter', () => {
    const md = '# Just a heading\n\nNo frontmatter.'
    const result = splitSkillMdFrontmatter(md)
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe(md)
  })
})

describe('skillMarkdownMetadata', () => {
  it('extracts name and description from SKILL.md frontmatter', () => {
    const md = `---
name: "Writing Voice"
description: 'How we write.'
---

# Writing Voice`

    expect(skillMarkdownMetadata(md)).toEqual({
      body: '# Writing Voice',
      description: 'How we write.',
      name: 'Writing Voice',
    })
  })
})

describe('slugifySkillName', () => {
  it('turns a skill name into a URL slug', () => {
    expect(slugifySkillName('Writing Voice v2')).toBe('writing-voice-v2')
    expect(slugifySkillName('  @Team / SQL.Style  ')).toBe('team-sql-style')
  })

  it('emits only the registry slug grammar ([a-z0-9-], max 63)', () => {
    expect(slugifySkillName('my_skill.v2')).toBe('my-skill-v2')
    const long = slugifySkillName(`${'very-'.repeat(20)}long`)
    expect(long.length).toBeLessThanOrEqual(63)
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/)
  })

  it('elides apostrophes instead of dashing them', () => {
    expect(slugifySkillName("Writer's Voice")).toBe('writers-voice')
    expect(slugifySkillName('Writer’s Voice')).toBe('writers-voice')
  })
})
