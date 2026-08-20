import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSkillBundleSummary } from '@/lib/skill-bundle-content'

const HASH = 'sha256:bigskill'
const SKILL_MD = '---\nname: big\n---\n' + 'x'.repeat(500)

function makeIndex(count: number) {
  const files = [{ path: 'SKILL.md', kind: 'text' as const, size: 500, executable: false }]
  for (let i = 0; i < count; i++) {
    files.push({
      path: `references/file-${i}.md`,
      kind: 'text' as const,
      size: 2000,
      executable: false,
    })
  }
  return { hash: HASH, files }
}

describe('skill page payload budget', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_REGISTRY_URL = 'http://reg.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url)
        if (u.includes('/manifest')) {
          return new Response(JSON.stringify({ latest_hash: HASH }), { status: 200 })
        }
        if (u.includes('/files') && !u.includes('/file?')) {
          return new Response(JSON.stringify(makeIndex(150)), { status: 200 })
        }
        if (u.includes('/file?')) {
          return new Response(
            JSON.stringify({
              path: 'SKILL.md',
              kind: 'text',
              size: 500,
              executable: false,
              text: SKILL_MD,
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_REGISTRY_URL
  })

  it('summary payload stays under budget with no supporting-file text', async () => {
    const summary = await getSkillBundleSummary('tay', 'marketing-skills')
    expect(summary).not.toBeNull()
    const supportingWithText = summary!.files.filter(
      (f) => f.path !== 'SKILL.md' && f.text != null,
    )
    expect(supportingWithText).toHaveLength(0)
    const bytes = JSON.stringify(summary).length
    expect(bytes).toBeLessThan(250_000)
  })
})
