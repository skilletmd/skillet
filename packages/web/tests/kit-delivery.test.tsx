import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KitDelivery } from '@/components/kits/kit-delivery'
import { KitBorrowLine } from '@/components/kits/kit-borrow-line'

const COMMAND = 'npx skilletmd add kit @shadcn/ui -y'

/** `accent` wraps its substring in a span, so the command is never one
 *  contiguous run in the markup. Assert against the text a reader sees. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
}

function delivery(props: Partial<Parameters<typeof KitDelivery>[0]> = {}) {
  return renderToStaticMarkup(
    KitDelivery({
      added: false,
      runtimes: [],
      command: COMMAND,
      accent: '@shadcn/ui',
      ...props,
    }),
  )
}

describe('a kit page asks for one thing, then delivers', () => {
  it('says nothing about install before the kit is added', () => {
    const html = delivery({ added: false, runtimes: [] })

    expect(html).toBe('')
  })

  it('offers both install paths once added with no client', () => {
    const html = delivery({ added: true, runtimes: [] })

    expect(text(html)).toContain('Get the Skillet app')
    expect(text(html)).toContain(COMMAND)
    // The lead reports what happened rather than pitching a product to someone
    // who already committed.
    expect(text(html)).toContain('Added.')
    expect(text(html)).not.toContain("It's free")
  })

  it('confirms where it landed instead of asking a connected user to install', () => {
    const html = delivery({ added: true, runtimes: ['claude-code', 'cursor', 'codex'] })

    expect(html).toContain('Added, and syncing to Claude Code, Cursor, and Codex.')
    expect(text(html)).not.toContain('Get the Skillet app')
    expect(text(html)).not.toContain(COMMAND)
  })

  it('reads correctly with one runtime and with two', () => {
    expect(delivery({ added: true, runtimes: ['cursor'] })).toContain('syncing to Cursor.')
    expect(delivery({ added: true, runtimes: ['cursor', 'codex'] })).toContain(
      'syncing to Cursor and Codex.',
    )
  })

  it('keeps a path for a machine the account has not paired', () => {
    const html = delivery({ added: true, runtimes: ['cursor'] })

    expect(html).toContain('Not on this machine?')
  })
})

describe('the kit borrow line', () => {
  it('points at the kit summon path, not the profile one', () => {
    const html = renderToStaticMarkup(KitBorrowLine({ owner: 'shadcn', slug: 'ui' }))

    expect(text(html)).toContain('skillet.md/@shadcn/kit/ui/summon')
    expect(text(html)).toContain('Try it now, nothing installed')
  })
})
