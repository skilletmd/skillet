import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SingleInstallPanel } from './single-install-panel'
import { skillInstallCommand } from '@/lib/cli-install-commands'

const writeText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  writable: true,
})

const command = skillInstallCommand('@alice/foo')
const accent = '@alice/foo'

beforeEach(() => {
  writeText.mockClear()
})

function commandText() {
  // The command string is the textContent of both the inner span and its
  // click-to-copy parent, so match-all and take the first.
  return screen.getAllByText((_content, element) => element?.textContent === command)[0]
}

describe('SingleInstallPanel', () => {
  it('renders the install command', () => {
    render(<SingleInstallPanel command={command} accent={accent} />)
    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.getByText('Get the Skillet app')).toBeInTheDocument()
    expect(commandText()).toBeInTheDocument()
  })

  it('highlights the accent substring', () => {
    render(<SingleInstallPanel command={command} accent={accent} />)
    expect(screen.getByText(accent)).toHaveClass('text-(--accent)')
  })

  it('copies the full command to the clipboard', async () => {
    render(<SingleInstallPanel command={command} accent={accent} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    })
    expect(writeText).toHaveBeenCalledWith(command)
  })
})
