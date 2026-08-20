import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsVisibilitySelect } from '@/components/agents-visibility-select'

const updateShownAgents = vi.fn()
vi.mock('@/lib/profile-update', () => ({
  updateShownAgents: (...args: unknown[]) => updateShownAgents(...args),
}))

beforeEach(() => updateShownAgents.mockReset().mockResolvedValue(undefined))
afterEach(() => vi.clearAllMocks())

function chip(name: RegExp) {
  return screen.getByRole('button', { name })
}

describe('AgentsVisibilySelect', () => {
  it('renders a chip per detected or selected agent — not the whole palette', () => {
    render(
      <AgentsVisibilitySelect handle="ada" detectedAgents={['cursor', 'figma']} initialShown={null} />,
    )
    // null pre-fills to the detected set, so only the two detected agents are chips
    // (chips carry aria-pressed; the "Add agent" menu trigger does not).
    const chips = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    expect(chips).toHaveLength(2)
    expect(chip(/Cursor/)).toBeTruthy()
    expect(chip(/figma/i)).toBeTruthy() // detected-but-not-canonical
    // An undetected, unselected canonical agent is NOT a chip — it lives in the menu.
    expect(screen.queryByRole('button', { name: /Devin Desktop/ })).toBeNull()
  })

  it('marks only device-detected chips verified', () => {
    render(
      <AgentsVisibilitySelect
        handle="ada"
        detectedAgents={['cursor']}
        initialShown={['cursor', 'windsurf']}
      />,
    )
    // cursor is detected → verified; windsurf is selected but not detected → not.
    expect(within(chip(/Cursor/)).queryByLabelText('Verified')).toBeTruthy()
    expect(within(chip(/Devin Desktop/)).queryByLabelText('Verified')).toBeNull()
  })

  it('pre-fills selection from shownAgents; null pre-fills all detected', () => {
    const { unmount } = render(
      <AgentsVisibilitySelect handle="ada" detectedAgents={['cursor', 'codex']} initialShown={['cursor']} />,
    )
    expect(chip(/Cursor/).getAttribute('aria-pressed')).toBe('true')
    expect(chip(/Codex/).getAttribute('aria-pressed')).toBe('false')
    unmount()

    render(
      <AgentsVisibilitySelect handle="ada" detectedAgents={['cursor', 'codex']} initialShown={null} />,
    )
    expect(chip(/Cursor/).getAttribute('aria-pressed')).toBe('true')
    expect(chip(/Codex/).getAttribute('aria-pressed')).toBe('true')
  })

  it('toggling a chip persists the updated list', async () => {
    // claude-code is detected, so it shows as an (off) chip you can toggle on.
    render(
      <AgentsVisibilitySelect
        handle="ada"
        detectedAgents={['claude-code', 'cursor']}
        initialShown={['cursor']}
      />,
    )
    await userEvent.click(chip(/Claude Code/))
    expect(updateShownAgents).toHaveBeenCalledTimes(1)
    const [handle, agents] = updateShownAgents.mock.calls[0]
    expect(handle).toBe('ada')
    // palette order: claude-code before cursor
    expect(agents).toEqual(['claude-code', 'cursor'])
  })

  it('deselecting the last chip persists [] (no master toggle)', async () => {
    render(<AgentsVisibilitySelect handle="ada" detectedAgents={['cursor']} initialShown={['cursor']} />)
    await userEvent.click(chip(/Cursor/))
    expect(updateShownAgents).toHaveBeenLastCalledWith('ada', [])
  })

  it('reverts the chip when the save fails', async () => {
    updateShownAgents.mockRejectedValueOnce(new Error('nope'))
    render(<AgentsVisibilitySelect handle="ada" detectedAgents={['cursor']} initialShown={[]} />)
    const cursor = chip(/Cursor/)
    expect(cursor.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(cursor)
    // optimistic on, then reverts to off after the rejected save
    expect(chip(/Cursor/).getAttribute('aria-pressed')).toBe('false')
  })

  it('offers long-tail agents in the Add-agent menu, not as chips by default', async () => {
    render(<AgentsVisibilitySelect handle="ada" detectedAgents={[]} initialShown={[]} />)
    // Gemini is long-tail: not a chip until added.
    expect(screen.queryByRole('button', { name: /Gemini/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Add agent/ }))
    expect(await screen.findByRole('menuitem', { name: /Gemini/ })).toBeTruthy()
  })

  it('adding from the menu persists it as a shown agent (unverified)', async () => {
    render(<AgentsVisibilitySelect handle="ada" detectedAgents={[]} initialShown={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /Add agent/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Gemini/ }))
    expect(updateShownAgents).toHaveBeenLastCalledWith('ada', ['gemini'])
    // It now renders as a chip with no verified mark.
    const gemini = chip(/Gemini/)
    expect(gemini.getAttribute('aria-pressed')).toBe('true')
    expect(within(gemini).queryByLabelText('Verified')).toBeNull()
  })
})
