import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { SkillIcon, KitStackIcon } from '@/components/directory-card'
import { SkillCard } from '@/components/skill-card'
import { buildCspValue } from '@/lib/security-headers'

vi.mock('@/components/use-theme', () => ({
  useTheme: () => 'light',
}))

vi.mock('@/components/kits/skill-kit-control', () => ({
  SkillKitControl: () => null,
}))

vi.mock('@/components/kits/used-by', () => ({
  UsedBy: () => null,
}))

describe('feed cover marks', () => {
  const wrap = (ui: ReactNode) =>
    render(<div style={{ position: 'relative', width: 56, height: 56 }}>{ui}</div>)

  it('uncategorized skill shows a neutral dashed list mark', () => {
    const { container } = wrap(<SkillIcon seed="acme/demo" category={null} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.innerHTML).toContain('stroke-dasharray')
  })

  it('categorized skill shows its colored category cover', () => {
    const { container } = wrap(<SkillIcon seed="acme/demo" category="research" />)
    // Painted covers put a category tint on a background style (serialized as
    // rgb() in jsdom) and a monochrome glyph; uncategorized stays dashed.
    expect(container.querySelector('[style*="background"]')).toBeTruthy()
    expect(container.innerHTML).not.toContain('stroke-dasharray')
  })

  it('uncategorized kit without categories still renders kit composition art', () => {
    const { container } = wrap(
      <KitStackIcon seed="acme/kit" categories={Array.from({ length: 3 }, () => null)} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.innerHTML).not.toContain('stroke-dasharray')
    expect(svg?.innerHTML.length).toBeGreaterThan(100)
  })

  it('SkillCard md shows neutral list mark when category is null', () => {
    const { container } = render(
      <SkillCard author="acme" slug="demo" category={null} addToKit={false} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.innerHTML).toContain('stroke-dasharray')
  })

  it('enforce CSP fixture includes Insights host for feed surfaces', () => {
    const policy = buildCspValue({ isDev: false })
    expect(policy).toContain('https://static.cloudflareinsights.com')
  })
})
