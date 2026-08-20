import { describe, expect, it } from 'vitest'
import { renderBadge } from './badge-svg'

describe('renderBadge apostrophe rendering', () => {
  it('renders apostrophe literally in SVG text nodes', () => {
    const svg = renderBadge({ style: 'flat', label: "it's", message: 'ok' })
    expect(svg).toContain(">it's<")
    expect(svg).not.toContain('&#39;')
  })

  it('still escapes angle brackets in text', () => {
    const svg = renderBadge({ style: 'button', message: '<bad>' })
    expect(svg).toContain('&lt;bad&gt;')
  })
})
