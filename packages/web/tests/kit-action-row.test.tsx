import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The real button carries the whole optimistic-subscribe stack (context, router
// refresh, auth redirect). The row's contract with it is one callback, so stand
// in something that fires it.
const enableMock = vi.hoisted(() => vi.fn())
const disableMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/(consumer)/settings/connectors-actions', () => ({
  enableMcpLinkAction: enableMock,
  disableMcpLinkAction: disableMock,
}))

vi.mock('@/components/kits/subscribe-kit-button', () => ({
  SubscribeKitButton: ({
    initialSubscribed,
    onSubscribedChange,
  }: {
    initialSubscribed: boolean
    onSubscribedChange?: (v: boolean) => void
  }) => (
    <button type="button" onClick={() => onSubscribedChange?.(!initialSubscribed)}>
      {initialSubscribed ? 'Added' : 'Add kit'}
    </button>
  ),
}))

import { KitActionRow } from '@/components/kits/kit-action-row'

function row(over: Partial<Parameters<typeof KitActionRow>[0]> = {}) {
  return render(
    <KitActionRow
      kitId="k1"
      owner="shadcn"
      initialSubscribed={false}
      viewerHandle="taylor"
      runtimes={[]}
      {...over}
    />,
  )
}

beforeEach(() => {
  enableMock.mockReset()
  disableMock.mockReset()
})

describe('the kit page asks for one thing', () => {
  it('offers exactly one button before you add', () => {
    row()

    expect(screen.getByRole('button', { name: 'Add kit' })).toBeInTheDocument()
    // Copy prompt used to sit here. A second button at the page's only decision
    // point competed with the one thing worth pressing, and produced a one-shot.
    expect(screen.queryByRole('button', { name: /Copy/i })).toBeNull()
  })

  it('says nothing under the button at rest', () => {
    row()

    expect(screen.queryByText(/Install Skillet/)).toBeNull()
    expect(screen.queryByText(/Ready in your agents/)).toBeNull()
  })
})

describe('the bar answers the press', () => {
  it('offers all three ways in once added with no client', async () => {
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))

    expect(await screen.findByText(/Install Skillet/)).toBeInTheDocument()
    // Three doors, not tabs over a panel: every visible control acts. A tab
    // looks like a button while doing nothing, which puts the loudest things on
    // the card above the only element that does something.
    // /setup, not /install: this viewer is signed in with nothing paired, and
    // the download page hands over a binary without the connect step.
    expect(screen.getByRole('link', { name: /Mac app/i })).toHaveAttribute('href', '/setup')
    expect(screen.getByRole('button', { name: /Copy the install command/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ChatGPT/i })).toBeInTheDocument()
  })

  it('mints nothing until the panel is opened', async () => {
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))

    // The link reads the whole kit view, team kits included. Arriving on a page
    // must never leave a live credential on an account that did not ask.
    expect(await screen.findByRole('button', { name: /ChatGPT/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(enableMock).not.toHaveBeenCalled()
  })

  it('turns MCP on with the same press that opens the panel', async () => {
    enableMock.mockResolvedValue({ ok: true, url: 'https://skillet.md/mcp/skillet_m_new' })
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    // Pressing Chat IS the intent. Making you then confirm you meant it is
    // ceremony on something undone from the same panel.
    expect(await screen.findByRole('button', { name: /Copy your private MCP link/i })).toBeInTheDocument()
    expect(enableMock).toHaveBeenCalled()
    expect(screen.getByText(/MCP is on/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Turn it off/i })).toBeInTheDocument()
  })

  it('hands over the link and where to paste it once enabled', async () => {
    enableMock.mockResolvedValue({ ok: true, url: 'https://skillet.md/mcp/skillet_m_new' })
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    expect(await screen.findByRole('button', { name: /Copy your private MCP link/i })).toBeInTheDocument()
    // The steps, not a link to the steps: a link is useless until it is pasted
    // somewhere, and saying where is the whole job of this panel.
    expect(screen.getByText(/Type \/skillet plus what you want/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Turn it off/i })).toBeInTheDocument()
  })

  it('shows one client at a time, and swaps on pick', async () => {
    enableMock.mockResolvedValue({ ok: true, url: 'https://skillet.md/mcp/skillet_m_new' })
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    // Both side by side was the tallest thing this card has held, and nobody
    // sets up ChatGPT and Claude.ai in the same sitting.
    // Both clients share the payoff line, so assert on a step unique to the one
    // that is open rather than on shared copy.
    expect(await screen.findByText(/New Plugin/)).toBeInTheDocument()
    expect(screen.queryByText(/Add custom connector/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /Claude\.ai/i }))

    // The doors ARE the tabs now: pressing the other brand swaps the steps,
    // with no inner tab row asking the same question twice.
    expect(await screen.findByText(/Add custom connector/)).toBeInTheDocument()
    expect(screen.queryByText(/New Plugin/)).toBeNull()
  })

  it('opens straight to the link when MCP is already on, minting nothing', async () => {
    const user = userEvent.setup()
    row({ mcpUrl: 'https://skillet.md/mcp/skillet_m_abc' })

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    expect(await screen.findByRole('button', { name: /Copy your private MCP link/i })).toBeInTheDocument()
    expect(enableMock).not.toHaveBeenCalled()
  })

  it('says so when enabling fails, instead of looking like it worked', async () => {
    enableMock.mockResolvedValue({ ok: false, error: 'Could not enable. Try again.' })
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    expect(await screen.findByText(/Could not enable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy your private MCP link/i })).toBeNull()
  })

  it('returns to the switch after turning MCP off', async () => {
    disableMock.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    row({ mcpUrl: 'https://skillet.md/mcp/skillet_m_abc' })

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))
    await user.click(await screen.findByRole('button', { name: /Turn it off/i }))

    expect(await screen.findByText(/Turning MCP on|Could not/)).toBeInTheDocument()
  })

  it('tells a connected viewer how to run it, and drops the handle', async () => {
    const user = userEvent.setup()
    row({ runtimes: ['claude-code', 'cursor'] })

    await user.click(screen.getByRole('button', { name: 'Add kit' }))

    // Summoning is for kits you have not taken. Once it is yours the skills are
    // in your own kit, so the instruction gets shorter, not longer.
    expect(await screen.findByText(/Ready in your agents/)).toBeInTheDocument()
    expect(screen.queryByText(/Install Skillet/)).toBeNull()
    expect(screen.queryByText(/summon/)).toBeNull()

    // Names the account's actual runtimes back to it. A generic "it worked"
    // asks the reader to take our word for it. The names are no longer a
    // visible line (they grew without bound), so the glyphs carry it and the
    // list stays reachable: title for hover, sr-only for touch and screen
    // readers, neither of which gets a hover.
    expect(screen.getByTitle('Claude Code')).toBeInTheDocument()
    expect(screen.getByTitle('Cursor')).toBeInTheDocument()
    expect(screen.getByText('Claude Code, Cursor')).toHaveClass('sr-only')
  })

  it('offers a way to manage the agents it just named', async () => {
    const user = userEvent.setup()
    row({ runtimes: ['claude-code', 'cursor'] })

    await user.click(screen.getByRole('button', { name: 'Add kit' }))

    // Naming three runtimes raises "what about my other machine?" and the box
    // had no answer. The link sits on the heading row, beside the claim it
    // qualifies, rather than adding a fourth line to a box built to be short.
    const manage = await screen.findByRole('link', { name: /Manage/i })
    expect(manage).toHaveAttribute('href', '/settings')
  })

  it('does not offer Manage before anything is connected', async () => {
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))

    // Nothing to manage yet: this viewer's next step is installing, and the
    // install doors already say that.
    expect(await screen.findByText(/Install Skillet/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Manage/i })).toBeNull()
  })

  it('shows the added state on arrival, with no press needed', () => {
    row({ initialSubscribed: true })

    // Persistent, not transient: owning the kit is a state you come back to,
    // and while it has nowhere to land there is still something to ask for.
    expect(screen.getByText(/Install Skillet/)).toBeInTheDocument()
  })
})

describe('the invocation differs per client', () => {
  it('gives ChatGPT the slash form and Claude the at-sign form', async () => {
    enableMock.mockResolvedValue({ ok: true, url: 'https://skillet.md/mcp/skillet_m_new' })
    const user = userEvent.setup()
    row()

    await user.click(screen.getByRole('button', { name: 'Add kit' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT/i }))

    // `/` is ChatGPT's own command affordance. `@skillet` does not fire there.
    expect(await screen.findByText(/Type \/skillet plus what you want/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Claude\.ai/i }))

    // Claude mentions connectors with `@`, matching the name from step 3.
    expect(await screen.findByText(/Type @skillet plus what you want/)).toBeInTheDocument()
  })
})
