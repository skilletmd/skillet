import { DeltaPill } from './delta-pill'
import { formatMultiple, growthMultiple, momPct } from './stat-math'

const numberFormat = new Intl.NumberFormat('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-01" → "Jan ’26". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`
}

// Geometry. Vector, so it scales with the container (w-full h-auto); the viewBox
// units are arbitrary "design pixels".
const W = 820
const H = 260
const PAD = { top: 26, right: 8, bottom: 30, left: 8 }
const INNER_W = W - PAD.left - PAD.right
const INNER_H = H - PAD.top - PAD.bottom
const BASE_Y = PAD.top + INNER_H

function points(values: number[], max: number): { x: number; y: number }[] {
  const n = values.length
  return values.map((v, i) => ({
    x: PAD.left + (n <= 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W),
    y: PAD.top + INNER_H - (max <= 0 ? 0 : (v / max) * INNER_H),
  }))
}

const linePath = (pts: { x: number; y: number }[]): string =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

/**
 * One metric's cumulative history, full size: the chart behind a stat card,
 * opened from it. Pure SVG, server-rendered, no charting dependency and no
 * client JS.
 *
 * Always renders, including from a standing start: with one month (or zero) of
 * history the curve degrades to a flat line at the current level rather than
 * disappearing. A real multi-month trend then layers on the gridline, the growth
 * multiple, and the month ticks.
 */
export function MetricChart({
  label,
  hint,
  months,
  series,
  value,
}: {
  label: string
  hint?: string
  /** Shared `YYYY-MM` axis, parallel to `series`. */
  months: string[]
  /** Cumulative monthly values. */
  series: number[]
  /** The current total. Usually the last point, but the totals are authoritative. */
  value: number
}) {
  const hasTrend = series.length >= 2
  const values = series.length ? series : [value]
  const flat = values.length === 1 ? [values[0], values[0]] : values

  const max = Math.max(1, ...values)
  // With a real trend the peak anchors the top of the plot. Before that, a lone
  // reading would pin to the top and flood-fill the panel, so give it headroom:
  // the flat starting line sits low and reads as "just getting going".
  const scaleMax = hasTrend ? max : max * 2.4
  const pts = points(flat, scaleMax)
  const area = `${linePath(pts)} L ${pts.at(-1)!.x.toFixed(1)} ${BASE_Y} L ${pts[0].x.toFixed(1)} ${BASE_Y} Z`

  const firstMonth = months[0] ?? ''
  const lastMonth = months.at(-1) ?? ''
  const midIdx = Math.floor((months.length - 1) / 2)
  const multiple = growthMultiple(values)
  const windowMonths = Math.max(0, months.length - 1)

  return (
    <div>
      {/* The punchline first: the total, its multiple and its MoM, so the curve
          has a headline a reader takes away in one glance. */}
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-(--accent)">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
        <span className="text-title font-semibold leading-none tracking-tight tabular-nums text-(--ink)">
          {numberFormat.format(value)}
        </span>
        {multiple && windowMonths > 0 && (
          <span className="text-base font-semibold text-(--success)">
            {formatMultiple(multiple)} in {windowMonths} months
          </span>
        )}
        <DeltaPill pct={momPct(values)} />
      </div>
      {hint && <p className="mt-1.5 text-sm text-(--ink-2)">{hint}</p>}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-5 h-auto w-full"
        role="img"
        aria-label={
          hasTrend
            ? `${label} from ${monthLabel(firstMonth)} to ${monthLabel(lastMonth)}: ${value} now.`
            : `${label}: ${value} so far.`
        }
      >
        <defs>
          <linearGradient
            id={`metric-fill-${label.replace(/\W+/g, '-')}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline always; the max gridline only once there's a trend to scale
            against (a lone reading pinned to the top reads as a bug, not data). */}
        <line
          x1={PAD.left}
          y1={BASE_Y}
          x2={W - PAD.right}
          y2={BASE_Y}
          stroke="var(--line)"
          strokeWidth="1"
        />
        {hasTrend && (
          <>
            <line
              x1={PAD.left}
              y1={PAD.top}
              x2={W - PAD.right}
              y2={PAD.top}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
            <text
              x={PAD.left}
              y={PAD.top - 8}
              className="fill-(--ink-2)"
              fontSize="13"
              fontWeight="600"
            >
              {numberFormat.format(max)}
            </text>
          </>
        )}

        <path d={area} fill={`url(#metric-fill-${label.replace(/\W+/g, '-')})`} />
        <path
          d={linePath(pts)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={pts.at(-1)!.x} cy={pts.at(-1)!.y} r="4" fill="var(--accent)" />

        {/* Month ticks: first · middle · last once there's a trend; a single
            centered label when there's just one month so far. */}
        {hasTrend ? (
          <>
            <text
              x={PAD.left}
              y={H - 8}
              className="fill-(--ink-2)"
              fontSize="13"
              textAnchor="start"
            >
              {monthLabel(firstMonth)}
            </text>
            {months.length > 2 && (
              <text
                x={W / 2}
                y={H - 8}
                className="fill-(--ink-2)"
                fontSize="13"
                textAnchor="middle"
              >
                {monthLabel(months[midIdx])}
              </text>
            )}
            <text
              x={W - PAD.right}
              y={H - 8}
              className="fill-(--ink-2)"
              fontSize="13"
              textAnchor="end"
            >
              {monthLabel(lastMonth)}
            </text>
          </>
        ) : (
          lastMonth && (
            <text x={W / 2} y={H - 8} className="fill-(--ink-2)" fontSize="13" textAnchor="middle">
              {monthLabel(lastMonth)}
            </text>
          )
        )}
      </svg>
    </div>
  )
}
