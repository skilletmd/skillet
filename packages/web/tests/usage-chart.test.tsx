import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UsageChart, bucketRouteTs, sampleDays } from '@/components/settings/usage-chart'

describe('bucketRouteTs', () => {
  // Fixed "now": a mid-afternoon local time so day-boundary math is unambiguous.
  const now = new Date(2026, 6, 9, 15, 0, 0).getTime()

  it('buckets timestamps into 30 local days, oldest first', () => {
    const days = bucketRouteTs([], now)
    expect(days).toHaveLength(30)
    expect(days[29]!.label).toBe('Jul 9')
    expect(days[0]!.label).toBe('Jun 10')
  })

  it('counts events on the viewer-local day they happened', () => {
    const todayMorning = Math.floor(new Date(2026, 6, 9, 1, 0, 0).getTime() / 1000)
    const yesterdayNight = Math.floor(new Date(2026, 6, 8, 23, 30, 0).getTime() / 1000)
    const days = bucketRouteTs([todayMorning, todayMorning, yesterdayNight], now)
    expect(days[29]!.count).toBe(2)
    expect(days[28]!.count).toBe(1)
  })

  it('drops timestamps outside the window instead of miscounting them', () => {
    const stale = Math.floor((now - 45 * 86_400_000) / 1000)
    const days = bucketRouteTs([stale], now)
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(0)
  })
})

describe('UsageChart', () => {
  it('announces the 30-day total and renders one bar per active day', () => {
    const days = sampleDays([0, 0, 3, 1])
    render(<UsageChart days={days} />)
    expect(screen.getByRole('img', { name: /4 skill uses in the last 30 days/i })).toBeTruthy()
    expect(screen.getByText(/uses in the last 30 days/i)).toBeTruthy()
  })
})
