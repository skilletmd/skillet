import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToggleSwitch } from './toggle-switch'

describe('ToggleSwitch', () => {
  it('reflects checked state in aria-checked', () => {
    const { rerender } = render(
      <ToggleSwitch checked={false} onChange={() => {}} ariaLabel="Test" />,
    )
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    rerender(<ToggleSwitch checked onChange={() => {}} ariaLabel="Test" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with the negated value on click', () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} ariaLabel="Test" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when toggling an on switch off', () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked onChange={onChange} ariaLabel="Test" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} disabled ariaLabel="Test" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves the thumb based on state', () => {
    const { rerender } = render(
      <ToggleSwitch checked={false} onChange={() => {}} ariaLabel="Test" />,
    )
    const thumb = screen.getByRole('switch').firstChild as HTMLElement
    expect(thumb.className).toContain('translate-x-0.5')
    rerender(<ToggleSwitch checked onChange={() => {}} ariaLabel="Test" />)
    expect(thumb.className).toContain('translate-x-[22px]')
  })
})
