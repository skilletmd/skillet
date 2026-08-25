import { DeltaPill } from './delta-pill'
import { MetricChart } from './metric-chart'
import { StatDialog } from './stat-dialog'
import { StatTile } from './stat-tile'
import { momPct } from './stat-math'

const numberFormat = new Intl.NumberFormat('en-US')

export interface Stat {
  /** Stable id, used as the sparkline gradient key. */
  id: string
  label: string
  value: number
  /** One-line context under the number (e.g. "across every agent"). */
  hint?: string
  /** Cumulative monthly series for this metric — drives the velocity sparkline,
   *  the month-over-month delta pill, and the full chart the card opens. Omit
   *  for a flat card that isn't clickable. */
  series?: number[]
}

/**
 * A faint cumulative sparkline that washes the bottom of a stat card, so the
 * number carries its trend with it. preserveAspectRatio="none" stretches it to
 * the full card width regardless of card size; normalized min→max so the shape
 * (the velocity) reads even when the absolute numbers are small.
 *
 * A single reading, or a series that hasn't moved, still draws: a level line
 * low in the card. Every card in a section then carries the same graphic
 * language, and week-one data reads as "no movement yet" rather than as a
 * missing element.
 */
function Sparkline({ id, series }: { id: string; series: number[] }) {
  if (series.length === 0) return null
  const W = 100
  const H = 36
  // The plotted band, as a fraction of the svg: the curve lives in the bottom
  // third so it reads as a wash under the card and never crosses the hint text.
  const BAND = H * 0.34
  const max = Math.max(...series)
  const min = Math.min(...series)
  const flat = max === min
  const values = series.length === 1 ? [series[0], series[0]] : series
  const range = max - min
  const x = (i: number) => (i / (values.length - 1)) * W
  // Flat series have no shape to normalize, so park the line at rest height.
  const y = (v: number) => (flat ? H - BAND / 2 : H - 2 - ((v - min) / range) * BAND)
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.28"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The headline grid: big, precise numbers, each washed with its own velocity
 * sparkline and opening its full chart on click. Full counts (not the compact
 * 1.2K used on cards) — this is the data page, the exactness is the point.
 * `months` is the shared axis every card's chart is plotted against.
 */
export function StatGrid({ stats, months = [] }: { stats: Stat[]; months?: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {stats.map((s) => {
        const card = (
          <StatTile
            label={s.label}
            value={numberFormat.format(s.value)}
            hint={s.hint}
            background={s.series ? <Sparkline id={s.id} series={s.series} /> : undefined}
            delta={s.series ? <DeltaPill pct={momPct(s.series)} /> : undefined}
          />
        )

        // Only a card with history has a chart worth opening; the rest stay
        // plain, so a click never leads to an empty modal.
        if (!s.series || s.series.length === 0)
          return (
            <div key={s.id} className="h-full">
              {card}
            </div>
          )

        return (
          <StatDialog
            key={s.id}
            title={s.label}
            card={card}
            chart={
              <MetricChart
                label={s.label}
                hint={s.hint}
                months={months}
                series={s.series}
                value={s.value}
              />
            }
          />
        )
      })}
    </div>
  )
}
