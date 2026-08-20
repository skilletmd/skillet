import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Notice } from './notice'

describe('Notice', () => {
  it('renders children', () => {
    render(<Notice>Connected X.</Notice>)
    expect(screen.getByText('Connected X.')).toBeInTheDocument()
  })

  it('uses role=status for info/success and role=alert for danger', () => {
    const { rerender } = render(<Notice tone="success">ok</Notice>)
    expect(screen.getByRole('status')).toBeInTheDocument()
    rerender(<Notice tone="danger">bad</Notice>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('applies the danger token set for tone=danger', () => {
    render(<Notice tone="danger">bad</Notice>)
    expect(screen.getByRole('alert').className).toContain('--danger')
  })
})
