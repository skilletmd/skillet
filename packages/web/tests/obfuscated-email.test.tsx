import { render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ObfuscatedEmail } from '@/components/obfuscated-email'

describe('ObfuscatedEmail', () => {
  it('assembles a working mailto after mount', async () => {
    render(<ObfuscatedEmail user="skilletdotmd" domain="gmail.com" subject="DMCA notice" />)
    const link = await waitFor(() => screen.getByRole('link'))
    expect(link).toHaveAttribute('href', 'mailto:skilletdotmd@gmail.com?subject=DMCA%20notice')
    expect(link).toHaveTextContent('skilletdotmd@gmail.com')
  })

  it('server output is scrape-resistant (no user@domain string, uses [at]/[dot])', () => {
    // The SSR markup a harvester reads must not contain the joined address —
    // useEffect hasn't run yet, so it shows the text fallback.
    const html = renderToStaticMarkup(<ObfuscatedEmail user="skilletdotmd" domain="gmail.com" />)
    expect(html).not.toContain('skilletdotmd@gmail.com')
    expect(html).not.toContain('mailto:')
    expect(html).toContain('[at]')
    expect(html).toContain('[dot]')
  })
})
