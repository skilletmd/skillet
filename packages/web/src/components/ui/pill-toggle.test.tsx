import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PillToggle } from './pill-toggle'

const OPTIONS = [
  { value: 'mac', label: 'macOS' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
] as const

describe('PillToggle', () => {
  it('renders one radio per option with the active one checked', () => {
    render(<PillToggle options={OPTIONS} value="windows" onChange={() => {}} ariaLabel="Platform" />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Windows' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'macOS' })).toHaveAttribute('aria-checked', 'false')
  })

  it('fires onChange with the clicked value', async () => {
    const onChange = vi.fn()
    render(<PillToggle options={OPTIONS} value="mac" onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Linux' }))
    expect(onChange).toHaveBeenCalledWith('linux')
  })

  it('renders an option icon when provided', () => {
    render(
      <PillToggle
        options={[{ value: 'mac', label: 'macOS', icon: <span data-testid="glyph" /> }]}
        value="mac"
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
  })

  it('uses tab semantics and wires aria-controls when semantics="tab"', () => {
    render(
      <PillToggle
        semantics="tab"
        options={[{ value: 'a', label: 'A', controls: 'panel-a' }]}
        value="a"
        onChange={() => {}}
        ariaLabel="Runtime"
      />,
    )
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tab = screen.getByRole('tab', { name: 'A' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(tab).toHaveAttribute('aria-controls', 'panel-a')
  })
})
