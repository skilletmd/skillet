import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatTile } from './stat-tile'

describe('StatTile', () => {
  it('full variant renders label, value, hint, and the delta slot', () => {
    render(
      <StatTile label="Installs" value="1,234" hint="across every agent" delta={<span>+5%</span>} />,
    )
    expect(screen.getByText('Installs')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('across every agent')).toBeInTheDocument()
    expect(screen.getByText('+5%')).toBeInTheDocument()
  })

  it('full variant omits the delta when none is passed', () => {
    render(<StatTile label="Installs" value="1,234" />)
    expect(screen.queryByText('+5%')).not.toBeInTheDocument()
  })

  it('compact variant renders a link when href is set', () => {
    render(<StatTile variant="compact" label="Followers" value="42" href="/grace/followers" />)
    const link = screen.getByRole('link', { name: /42 Followers/ })
    expect(link).toHaveAttribute('href', '/grace/followers')
  })

  it('compact variant renders no link when href is absent', () => {
    render(<StatTile variant="compact" label="Skills" value="7" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
  })
})
