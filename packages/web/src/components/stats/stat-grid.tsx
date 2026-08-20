import { DeltaPill } from './delta-pill'
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
  /** Cumulative monthly series for this metric — drives the velocity sparkline
   *  AND the month-over-month delta pill. Omit (or <2 points) for a flat card. */
  series?: number[]
}

/**
 * A faint cumulative sparkline that washes the bottom of a stat card, so the
 * number carries its trend with it. preserveAspectRatio="none" stretches it to
 * the full card width regardless of card size; normalized min→max so the shape
 * (the velocity) reads even when the absolute numbers are small.
 */
function Sparkline({ id, series }: { id: string; series: number[] }) {
  if (series.length < 2) return null
  const W = 100
  const H = 36
  const PAD = 3
  const max = Math.max(...series)
  const min = Math.min(...series)
  // A perfectly flat series (e.g. a metric with no timestamped history yet) has
  // no trend to show — render nothing rather than a dead baseline.
  if (max === min) return null
  const range = max - min
  const x = (i: number) => (i / (series.length - 1)) * W
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2)
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-12 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The headline row: big, precise numbers in a card grid, each washed with its own
 * velocity sparkline. Full counts (not the compact 1.2K used on cards) — this is
 * the data page, the exactness is the point.
 */
/** A labeled band of stat cards — the page groups its eight metrics into a
 *  couple of these (e.g. "Momentum", "Network depth") so the numbers read as a
 *  story instead of an undifferentiated grid. */
export function StatSection({ label, stats }: { label: string; stats: Stat[] }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-(--ink)">{label}</h2>
      <StatGrid stats={stats} />
    </section>
  )
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <StatTile
          key={s.id}
          label={s.label}
          value={numberFormat.format(s.value)}
          hint={s.hint}
          background={s.series ? <Sparkline id={s.id} series={s.series} /> : undefined}
          delta={s.series ? <DeltaPill pct={momPct(s.series)} /> : undefined}
        />
      ))}
    </div>
  )
}
