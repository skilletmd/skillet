import { describe, it, expect } from 'vitest'
import {
  getSkill,
  getAuthorProfile,
  getAllSkillSlugs,
  getAllAuthorUsernames,
  getSkillCatalog,
} from '@/lib/registry'

describe('registry (mock data fallback)', () => {
  it('returns a skill by author + slug', async () => {
    const skill = await getSkill('skillet', 'skillet-sync')
    expect(skill).not.toBeNull()
    expect(skill?.title).toBe('skillet-sync')
    expect(skill?.versions.length).toBeGreaterThan(0)
  })

  it('returns null for unknown skill', async () => {
    const skill = await getSkill('nobody', 'nonexistent')
    expect(skill).toBeNull()
  })

  it('returns author profile with skills', async () => {
    const profile = await getAuthorProfile('skillet')
    expect(profile).not.toBeNull()
    expect(profile?.skills.length).toBeGreaterThan(0)
  })

  it('returns null for unknown author', async () => {
    const profile = await getAuthorProfile('nobody')
    expect(profile).toBeNull()
  })

  it('getAllSkillSlugs returns author+slug pairs', async () => {
    const slugs = await getAllSkillSlugs()
    expect(slugs.length).toBeGreaterThan(0)
    expect(slugs[0]).toHaveProperty('author')
    expect(slugs[0]).toHaveProperty('slug')
  })

  it('getAllAuthorUsernames returns strings', async () => {
    const usernames = await getAllAuthorUsernames()
    expect(usernames.length).toBeGreaterThan(0)
    expect(typeof usernames[0]).toBe('string')
  })
})

describe('getSkillCatalog (mock fallback)', () => {
  it('returns the paginated envelope shape', async () => {
    const res = await getSkillCatalog({ limit: 3, offset: 0 })
    expect(res).toMatchObject({ limit: 3, offset: 0 })
    expect(typeof res.total).toBe('number')
    expect(res.skills.length).toBeLessThanOrEqual(3)
    expect(res.skills[0]).toHaveProperty('install_count')
    expect(res.skills[0]).toHaveProperty('signatureStatus')
  })

  it('orders results most-installed first', async () => {
    const { skills } = await getSkillCatalog({ limit: 100 })
    const counts = skills.map((s) => s.install_count)
    const sorted = [...counts].sort((a, b) => b - a)
    expect(counts).toEqual(sorted)
  })

  it('respects limit/offset pagination without overlap', async () => {
    const first = await getSkillCatalog({ limit: 2, offset: 0 })
    const second = await getSkillCatalog({ limit: 2, offset: 2 })
    expect(first.total).toBe(second.total)
    const ids = new Set(first.skills.map((s) => s.skill_id))
    expect(second.skills.every((s) => !ids.has(s.skill_id))).toBe(true)
  })

  it('filters by q across slug and description', async () => {
    const { skills, total } = await getSkillCatalog({ q: 'deploy' })
    expect(total).toBeGreaterThan(0)
    expect(skills.every((s) => /deploy/i.test(`${s.slug} ${s.description ?? ''}`))).toBe(true)
  })

  it('returns an empty result set for a no-match query', async () => {
    const { skills, total } = await getSkillCatalog({ q: 'zzz-no-such-skill' })
    expect(total).toBe(0)
    expect(skills).toEqual([])
  })
})
