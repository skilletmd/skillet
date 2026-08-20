import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RuntimeInstallSection } from '@/components/runtime-install-section'

const writeText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  writable: true,
})

beforeEach(() => {
  writeText.mockClear()
  window.sessionStorage.clear()
})

function commandText() {
  return screen.getByText(
    (_content, element) =>
      element?.textContent === 'npx skilletmd add @skillethq/git-workflow -y',
  )
}

describe('RuntimeInstallSection', () => {
  it('renders all six runtime tabs with Claude selected by default', () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    for (const label of ['Claude', 'Codex', 'Cursor', 'Devin Desktop', 'ChatGPT', 'Hermes']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the npx add command for every runtime', () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    expect(commandText()).toBeInTheDocument()
  })

  it('swaps helper text when switching runtimes', async () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    expect(screen.getByText(/A pack for Claude\.ai/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'ChatGPT' }))
    })
    expect(screen.getByText(/ChatGPT has no skills push API/i)).toBeInTheDocument()
    expect(screen.queryByText(/A pack for Claude\.ai/i)).not.toBeInTheDocument()
    expect(commandText()).toBeInTheDocument()
    expect(screen.queryByText('Step 2 · Sync to ChatGPT')).not.toBeInTheDocument()
  })

  it('shows a sync step for file-based runtimes', async () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }))
    })
    expect(screen.getByText('Step 2 · Sync to Cursor')).toBeInTheDocument()
    expect(
      screen.getByText((_content, el) => el?.textContent === 'skillet sync'),
    ).toBeInTheDocument()
  })

  it('marks the active runtime tab with aria-current', async () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Codex' }))
    })
    expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('tab', { name: 'Claude' })).not.toHaveAttribute('aria-current')
  })

  it('persists the selected runtime in sessionStorage', async () => {
    const { unmount } = render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }))
    })
    expect(window.sessionStorage.getItem('skillet_preferred_runtime')).toBe('cursor')

    unmount()
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    expect(screen.getByRole('tab', { name: 'Cursor' })).toHaveAttribute('aria-selected', 'true')
  })

  it('copies the command to the clipboard', async () => {
    render(<RuntimeInstallSection author="skillethq" slug="git-workflow" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    })
    expect(writeText).toHaveBeenCalledWith('npx skilletmd add @skillethq/git-workflow -y')
  })
})
