import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatShortDate, timeAgo } from '@/lib/feed-format'

describe('timeAgo', () => {
  // Pin "now" so each bucket is exercised against a fixed clock.
  const NOW_MS = Date.UTC(2026, 5, 25, 12, 0, 0)
  const nowSeconds = Math.floor(NOW_MS / 1000)
  // `at` is `secondsAgo` before now, the input timeAgo receives.
  const at = (secondsAgo: number) => nowSeconds - secondsAgo

  const MIN = 60
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  const MONTH = 30 * DAY // timeAgo's month == 30 days
  const YEAR = 12 * MONTH

  afterEach(() => {
    vi.useRealTimers()
  })

  function withClock<T>(fn: () => T): T {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
    try {
      return fn()
    } finally {
      vi.useRealTimers()
    }
  }

  // Default path (no opts) — these are the exact strings the feed rows,
  // profile-activity, and notification-row have always rendered. Locking them in
  // proves the suffix option did not move the default output.
  describe('default path (no suffix) — current output is unchanged', () => {
    it('renders "just now" for < 60s', () => {
      withClock(() => {
        expect(timeAgo(at(0))).toBe('just now')
        expect(timeAgo(at(59))).toBe('just now')
      })
    })

    it('renders minutes "Nm" for the minute bucket', () => {
      withClock(() => {
        expect(timeAgo(at(MIN))).toBe('1m')
        expect(timeAgo(at(5 * MIN))).toBe('5m')
        expect(timeAgo(at(59 * MIN))).toBe('59m')
      })
    })

    it('renders hours "Nh" for the hour bucket', () => {
      withClock(() => {
        expect(timeAgo(at(HOUR))).toBe('1h')
        expect(timeAgo(at(3 * HOUR))).toBe('3h')
        expect(timeAgo(at(23 * HOUR))).toBe('23h')
      })
    })

    it('renders days "Nd" for the day bucket', () => {
      withClock(() => {
        expect(timeAgo(at(DAY))).toBe('1d')
        expect(timeAgo(at(2 * DAY))).toBe('2d')
        expect(timeAgo(at(29 * DAY))).toBe('29d')
      })
    })

    it('renders months "Nmo" for the month bucket', () => {
      withClock(() => {
        expect(timeAgo(at(MONTH))).toBe('1mo')
        expect(timeAgo(at(4 * MONTH))).toBe('4mo')
        expect(timeAgo(at(11 * MONTH))).toBe('11mo')
      })
    })

    it('renders years "Ny" for the year bucket', () => {
      withClock(() => {
        expect(timeAgo(at(YEAR))).toBe('1y')
        expect(timeAgo(at(2 * YEAR))).toBe('2y')
      })
    })

    it('clamps future timestamps to "just now"', () => {
      withClock(() => {
        expect(timeAgo(at(-5 * MIN))).toBe('just now')
      })
    })
  })

  // suffix:true appends " ago" to every relative bucket. "just now" is left as-is
  // (matching the old proposed-changes relativeTime, which also returned a bare
  // "just now"). This is the proposed-changes path.
  describe('suffix:true appends " ago"', () => {
    it('leaves "just now" unchanged', () => {
      withClock(() => {
        expect(timeAgo(at(0), { suffix: true })).toBe('just now')
      })
    })

    it('appends " ago" to each relative bucket', () => {
      withClock(() => {
        expect(timeAgo(at(5 * MIN), { suffix: true })).toBe('5m ago')
        expect(timeAgo(at(3 * HOUR), { suffix: true })).toBe('3h ago')
        expect(timeAgo(at(2 * DAY), { suffix: true })).toBe('2d ago')
        expect(timeAgo(at(4 * MONTH), { suffix: true })).toBe('4mo ago')
        expect(timeAgo(at(2 * YEAR), { suffix: true })).toBe('2y ago')
      })
    })

    it('suffix:false is identical to the default path', () => {
      withClock(() => {
        expect(timeAgo(at(3 * HOUR), { suffix: false })).toBe(timeAgo(at(3 * HOUR)))
      })
    })
  })
})

describe('formatShortDate', () => {
  // Noon UTC on 2026-06-25 — far enough from midnight that any reasonable
  // runtime timezone still lands on the same calendar day.
  const ms = Date.UTC(2026, 5, 25, 12, 0, 0)
  const seconds = Math.floor(ms / 1000)

  it('formats unix-seconds input as "Mon D, YYYY"', () => {
    expect(formatShortDate(seconds)).toBe('Jun 25, 2026')
  })

  it('formats millisecond input as "Mon D, YYYY"', () => {
    expect(formatShortDate(ms)).toBe('Jun 25, 2026')
  })

  it('formats an ISO string input as "Mon D, YYYY"', () => {
    expect(formatShortDate('2026-06-25T12:00:00Z')).toBe('Jun 25, 2026')
  })

  it('treats seconds, ms, and ISO inputs as the same instant', () => {
    expect(formatShortDate(seconds)).toBe(formatShortDate(ms))
    expect(formatShortDate(ms)).toBe(formatShortDate('2026-06-25T12:00:00Z'))
  })

  it('returns "" for invalid or empty input without throwing', () => {
    expect(formatShortDate(NaN)).toBe('')
    expect(formatShortDate('not a date')).toBe('')
    expect(formatShortDate('')).toBe('')
    expect(formatShortDate(null)).toBe('')
    expect(formatShortDate(undefined)).toBe('')
  })
})
