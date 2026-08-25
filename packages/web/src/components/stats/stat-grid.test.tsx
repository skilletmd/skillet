import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatGrid } from './stat-grid'

const MONTHS = ['2026-06', '2026-07', '2026-08']

describe('StatGrid', () => {
  it('opens the metric chart from a card with history', async () => {
    render(
      <StatGrid
        months={MONTHS}
        stats={[{ id: 'skills', label: 'Public skills', value: 1365, series: [400, 900, 1365] }]}
      />,
    )

    const card = screen.getByRole('button', { name: /Public skills/ })
    await userEvent.click(card)

    const chart = await screen.findByRole('img', { name: /Public skills from Jun ’26 to Aug ’26/ })
    expect(chart).toBeInTheDocument()
  })

  it('leaves a card without history unclickable', () => {
    render(<StatGrid months={MONTHS} stats={[{ id: 'summons', label: 'Summons', value: 2 }]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Summons')).toBeInTheDocument()
  })
})
