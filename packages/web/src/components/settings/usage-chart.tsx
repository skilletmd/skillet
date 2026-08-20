'use client'

import { useState } from 'react'

export interface UsageDay {
  /** Short local-date label, e.g. "Jul 7". */
  label: string
  count: number
}

const DAYS = 30
const MS_PER_DAY = 86_400_000

/**
 * Bucket raw route timestamps (epoch seconds) into the last 30 local days,
 * oldest first. Buckets are built per calendar day (not fixed 24h steps) so a
 * DST shift doesn't smear an evening into the wrong bar.
 */
export function bucketRouteTs(tsSeconds: number[], now = Date.now()): UsageDay[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days: UsageDay[] = []
  const indexByDate = new Map<string, number>()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    indexByDate.set(d.toDateString(), days.length)
    days.push({
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: 0,
    })
  }
  for (const ts of tsSeconds) {
    const ms = ts * 1000
    if (!Number.isFinite(ms) || ms > now + MS_PER_DAY) continue
    const idx = indexByDate.get(new Date(ms).toDateString())
    if (idx !== undefined) days[idx]!.count += 1
  }
  return days
}

/** Turn a hardcoded per-day series (oldest first) into labeled days ending today. */
export function sampleDays(counts: number[], now = Date.now()): UsageDay[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return counts.map((count, i) => {
    const d = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (counts.length - 1 - i),
    )
    return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count }
  })
}

// Geometry in viewBox "design pixels"; the SVG scales with the panel width.
const W = 640
const H = 150
const PAD = { top: 26, right: 0, bottom: 20, left: 0 }
const INNER_W = W - PAD.left - PAD.right
const INNER_H = H - PAD.top - PAD.bottom
const BASE_Y = PAD.top + INNER_H
const GAP = 4

/** A bar with a rounded top anchored flat on the baseline. */
function barPath(x: number, w: number, h: number): string {
  const r = Math.min(3, w / 2, h)
  const y = BASE_Y - h
  return [
    `M ${x.toFixed(1)} ${BASE_Y}`,
    `L ${x.toFixed(1)} ${(y + r).toFixed(1)}`,
    `Q ${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}`,
    `L ${(x + w - r).toFixed(1)} ${y.toFixed(1)}`,
    `Q ${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}`,
    `L ${(x + w).toFixed(1)} ${BASE_Y}`,
    'Z',
  ].join(' ')
}

/**
 * Uses per day, last 30 days — one bar per local day, newest on the right.
 * Pure SVG in the house idiom (see stats/growth-chart.tsx): no chart
 * dependency, tokens for every color, text in ink tokens only.
 */
export function UsageChart({ days }: { days: UsageDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = days.reduce((n, d) => n + d.count, 0)
  const max = Math.max(1, ...days.map((d) => d.count))
  const slot = INNER_W / days.length
  const barW = Math.max(2, slot - GAP)
  const hovered = hover != null ? days[hover] : null

  return (
    <div>
      <p className="mb-2">
        <span className="text-2xl font-semibold leading-none tabular-nums text-(--ink)">
          {total}
        </span>{' '}
        <span className="text-sm text-(--ink-2)">
          {total === 1 ? 'use' : 'uses'} in the last 30 days
        </span>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${total} skill ${total === 1 ? 'use' : 'uses'} in the last 30 days, by day.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Hover readout lives in a fixed slot above the plot so it never
            collides with bars or clips at the edges. */}
        {hovered && (
          <text
            x={W - PAD.right}
            y={PAD.top - 10}
            textAnchor="end"
            fontSize="13"
            fontWeight="600"
            className="fill-(--ink)"
          >
            {hovered.label} · {hovered.count} {hovered.count === 1 ? 'use' : 'uses'}
          </text>
        )}
        {!hovered && max > 1 && (
          <text
            x={PAD.left}
            y={PAD.top - 10}
            fontSize="13"
            fontWeight="600"
            className="fill-(--ink-2)"
          >
            {max}
          </text>
        )}
        {max > 1 && (
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={W - PAD.right}
            y2={PAD.top}
            stroke="var(--line)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
        )}
        <line
          x1={PAD.left}
          y1={BASE_Y}
          x2={W - PAD.right}
          y2={BASE_Y}
          stroke="var(--line)"
          strokeWidth="1"
        />

        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          return (
            <g key={i}>
              {hover === i && (
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={INNER_H}
                  fill="var(--accent-bg)"
                  opacity="0.6"
                />
              )}
              {d.count > 0 && (
                <path
                  d={barPath(x, barW, Math.max(3, (d.count / max) * INNER_H))}
                  fill="var(--accent)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {/* Full-height hit target — bars are thin, days should not be. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={INNER_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          )
        })}

        <text
          x={PAD.left}
          y={H - 4}
          fontSize="13"
          textAnchor="start"
          className="fill-(--ink-2)"
        >
          {days[0]?.label ?? ''}
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize="13" textAnchor="end" className="fill-(--ink-2)">
          Today
        </text>
      </svg>
    </div>
  )
}
