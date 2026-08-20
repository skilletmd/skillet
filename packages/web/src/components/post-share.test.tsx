import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PostShare } from './post-share'

const URL_ = 'https://skillet.md/blog/a-post'
const TITLE = 'Skills & agents: a post'

afterEach(() => vi.restoreAllMocks())

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  return writeText
}

describe('PostShare (U9)', () => {
  it('copies the canonical URL and flashes a confirmation', async () => {
    const writeText = stubClipboard()
    render(<PostShare url={URL_} title={TITLE} />)

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(writeText).toHaveBeenCalledWith(URL_)
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy())
  })

  it('carries the title and URL, encoded, into the share link', () => {
    render(<PostShare url={URL_} title={TITLE} />)
    const href = screen.getByRole('link', { name: /share/i }).getAttribute('href') ?? ''
    const params = new URL(href).searchParams

    expect(params.get('url')).toBe(URL_)
    expect(params.get('text')).toBe(TITLE)
  })

  it('opens the external share target without handing it window.opener', () => {
    render(<PostShare url={URL_} title={TITLE} />)
    const link = screen.getByRole('link', { name: /share/i })

    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('leaves the label alone when the clipboard write is refused', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    })
    render(<PostShare url={URL_} title={TITLE} />)

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()
  })

  it('uses no em-dash in its labels', () => {
    const { container } = render(<PostShare url={URL_} title={TITLE} />)
    expect(container.textContent).not.toContain('—')
  })
})
