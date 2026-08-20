import type { GrowthPoint } from '@/lib/registry'
import { DeltaPill } from './delta-pill'
import { formatMultiple, growthMultiple, momPct } from './stat-math'
import { Panel } from '@/components/ui/panel'

const numberFormat = new Intl.NumberFormat('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-01" → "Jan ’26". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`
}

// Geometry. Vector, so it scales with the container (w-full h-auto); the viewBox
// units are arbitrary "design pixels".
const W = 820
const H = 280
const PAD = { top: 24, right: 8, bottom: 30, left: 8 }
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
 * Cumulative growth — skills (filled area) and members (dashed line) on one
 * shared axis. Pure SVG, server-rendered: no charting dependency, no client JS.
 *
 * Always renders, including from a standing start: with one month (or zero) of
 * history the curve degrades to a flat line at the current level rather than the
 * section disappearing — the page has to be useful in week one, not just after a
 * trend exists. A real multi-month trend only then layers on the gridline, the
 * growth multiple, and the month ticks.
 */
export function GrowthChart({ growth }: { growth: GrowthPoint[] }) {
  const hasTrend = growth.length >= 2

  const last = growth.at(-1) ?? { month: '', skills: 0, users: 0 }
  const first = growth[0] ?? last

  // Pad a single (or empty) reading to a flat 2-point line spanning the width.
  const skillVals = growth.length ? growth.map((g) => g.skills) : [0]
  const userVals = growth.length ? growth.map((g) => g.users) : [0]
  const flatten = (v: number[]) => (v.length === 1 ? [v[0], v[0]] : v)
  const max = Math.max(1, ...skillVals, ...userVals)
  // With a real trend the peak anchors the top of the plot. Before that, a lone
  // reading would pin to the top and flood-fill the panel — give it headroom so
  // the flat starting line sits low, reading as "just getting going".
  const scaleMax = hasTrend ? max : max * 2.4
  const skillPts = points(flatten(skillVals), scaleMax)
  const userPts = points(flatten(userVals), scaleMax)
  const skillArea = `${linePath(skillPts)} L ${skillPts.at(-1)!.x.toFixed(1)} ${BASE_Y} L ${skillPts[0].x.toFixed(1)} ${BASE_Y} Z`

  const midIdx = Math.floor((growth.length - 1) / 2)
  const multiple = growthMultiple(skillVals)
  const windowMonths = growth.length - 1

  return (
    <Panel padding="none" className="p-5 sm:p-7">
      {/* The punchline first: a multiple + MoM, so the curve has a headline a
          reader takes away in one glance — not just an axis to interpret. */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-(--accent)">
            Skills on the network
          </p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
            <span className="text-title font-semibold leading-none tracking-tight tabular-nums text-(--ink)">
              {numberFormat.format(last.skills)}
            </span>
            {multiple && windowMonths > 0 && (
              <span className="text-base font-semibold text-(--success)">
                {formatMultiple(multiple)} in {windowMonths} months
              </span>
            )}
            <DeltaPill pct={momPct(skillVals)} />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium text-(--ink-2)">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-(--accent)" aria-hidden />
            Skills
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-(--ink-2)" aria-hidden />
            {numberFormat.format(last.users)} members
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          hasTrend
            ? `Cumulative growth from ${monthLabel(first.month)} to ${monthLabel(last.month)}: ${last.skills} skills on the network and ${last.users} members.`
            : `${last.skills} skills on the network and ${last.users} members so far.`
        }
      >
        <defs>
          <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
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

        <path d={skillArea} fill="url(#growth-fill)" />
        <path
          d={linePath(userPts)}
          fill="none"
          stroke="var(--ink-2)"
          strokeWidth="2"
          strokeOpacity="0.55"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="2 6"
        />
        <path
          d={linePath(skillPts)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Endpoint dot on the headline series. */}
        <circle cx={skillPts.at(-1)!.x} cy={skillPts.at(-1)!.y} r="4" fill="var(--accent)" />

        {/* Month ticks: full first · middle · last once there's a trend; a single
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
              {monthLabel(first.month)}
            </text>
            {growth.length > 2 && (
              <text
                x={W / 2}
                y={H - 8}
                className="fill-(--ink-2)"
                fontSize="13"
                textAnchor="middle"
              >
                {monthLabel(growth[midIdx].month)}
              </text>
            )}
            <text
              x={W - PAD.right}
              y={H - 8}
              className="fill-(--ink-2)"
              fontSize="13"
              textAnchor="end"
            >
              {monthLabel(last.month)}
            </text>
          </>
        ) : (
          last.month && (
            <text x={W / 2} y={H - 8} className="fill-(--ink-2)" fontSize="13" textAnchor="middle">
              {monthLabel(last.month)}
            </text>
          )
        )}
      </svg>
    </Panel>
  )
}
