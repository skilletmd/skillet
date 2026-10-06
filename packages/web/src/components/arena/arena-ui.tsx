import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { cn } from '@/lib/cn'
import {
  neededFor,
  roundHref,
  voteHref,
  type ArenaJury,
  type ArenaResult,
  type ArenaRound,
  type ArenaVersion,
  type Pick,
  type Side,
} from '@/lib/arena/rounds'

const numberFormat = new Intl.NumberFormat('en-US')

/** The version's color, as a dot. Color follows the version everywhere. */
export function SideDot({ side, className }: { side: Side; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        side === 'A' ? 'bg-(--arena-a)' : 'bg-(--arena-b)',
        className,
      )}
    />
  )
}

export function StatusBadge({ round }: { round: ArenaRound }) {
  if (round.status === 'open') return <Badge variant="success">Voting</Badge>
  if (round.status === 'upcoming') return <Badge>Locks {round.dates.locks}</Badge>
  return <Badge>Closed {round.dates.closed}</Badge>
}

export function VerdictBadge({ result }: { result: ArenaResult }) {
  if (result.verdict === 'won') return <Badge variant="success">Won</Badge>
  if (result.verdict === 'lost') return <Badge variant="danger-soft">Lost</Badge>
  return <Badge variant="warning">No call</Badge>
}

function versionName(v: ArenaVersion) {
  return (
    <>
      <span className="font-mono">{v.name}</span>{' '}
      <span className="font-mono font-normal text-(--ink-2)">{v.version}</span>
    </>
  )
}

/** One-line "A vs B" for cards and rails. A shared name is said once. */
export function VersionLine({ round }: { round: ArenaRound }) {
  const [a, b] = round.versions
  const sameName = a.name === b.name
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-(--ink)">
      {sameName ? <span className="font-mono">{a.name}</span> : null}
      <span className="inline-flex items-center gap-2">
        <SideDot side="A" />
        {sameName ? <span className="font-mono">{a.version}</span> : versionName(a)}
      </span>
      <span className="text-(--ink-2)">vs</span>
      <span className="inline-flex items-center gap-2">
        <SideDot side="B" />
        {sameName ? <span className="font-mono">{b.version}</span> : versionName(b)}
      </span>
    </p>
  )
}

export function VersionCards({ round }: { round: ArenaRound }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {round.versions.map((v) => (
        <Panel key={v.side} as="article" className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-(--ink-2)">
            <SideDot side={v.side} />
            <span className="font-mono font-semibold text-(--ink)">{v.side}</span>
            <span aria-hidden="true">·</span>
            <span>{v.role}</span>
          </p>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-(--ink)">
              {v.href ? (
                <Link href={v.href} className="hover:underline hover:underline-offset-4">
                  {versionName(v)}
                </Link>
              ) : (
                versionName(v)
              )}
            </h3>
            <p className="mt-0.5 text-sm text-(--ink-2)">by @{v.author}</p>
          </div>
          <p className="text-sm leading-relaxed text-(--ink-2)">{v.note}</p>
          <p className="mt-auto font-mono text-xs text-(--ink-2)">Locked at {v.hash}</p>
        </Panel>
      ))}
    </div>
  )
}

const COUNTS_BADGE: Record<ArenaJury['counts'], React.ReactNode> = {
  Decides: <Badge variant="accent">Decides</Badge>,
  'Cross-check': <Badge>Cross-check</Badge>,
  'Shown only': <Badge>Shown only</Badge>,
  'Evidence only': <Badge>Evidence only</Badge>,
}

function juryFigure(jury: ArenaJury, round: ArenaRound): string {
  if (round.status !== 'closed') {
    return jury.of
      ? `${jury.voters} of ${jury.of} voted`
      : `${numberFormat.format(jury.voters)} voted`
  }
  if (jury.kind === 'jury') return `${jury.voters} people`
  if (jury.kind === 'public' && jury.shareB !== undefined) {
    return `${jury.shareB}% picked ${round.versions[1].version}`
  }
  if (jury.agreement !== undefined) return `Agreed with the jury ${jury.agreement}%`
  return `${numberFormat.format(jury.voters)} voted`
}

export function JuryList({ round }: { round: ArenaRound }) {
  return (
    <Panel as="ul" padding="none" className="divide-y divide-(--line)">
      {round.juries.map((jury) => (
        <li
          key={jury.kind}
          className="grid gap-x-4 gap-y-1 px-5 py-4 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="flex items-center justify-between gap-3 sm:block">
            <p className="font-semibold text-(--ink)">{jury.name}</p>
            <span className="sm:hidden">{COUNTS_BADGE[jury.counts]}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-(--ink-2)">{jury.who}</p>
            {round.status === 'closed' && jury.note ? (
              <p className="mt-0.5 text-sm text-(--ink-2)">{jury.note}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <span className="text-sm tabular-nums text-(--ink)">{juryFigure(jury, round)}</span>
            <span className="max-sm:hidden">{COUNTS_BADGE[jury.counts]}</span>
          </div>
        </li>
      ))}
    </Panel>
  )
}

/** The jury's tally as one bar of decided pairs, B first, with the bar B had
 *  to clear marked on it. Ties sit outside the bar: they don't count. */
export function TallyBar({ round, result }: { round: ArenaRound; result: ArenaResult }) {
  const [a, b] = round.versions
  const decided = result.a + result.b
  const needed = neededFor(decided)
  const bShare = (result.b / decided) * 100
  const neededAt = (needed / decided) * 100
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative pt-6">
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs text-(--ink-2)"
          style={{ left: `${neededAt}%` }}
        >
          Needed {needed}
        </span>
        <div
          className="flex h-3 gap-0.5"
          role="img"
          aria-label={`${b.version} won ${result.b} pairs, ${a.version} won ${result.a}. ${needed} of ${decided} were needed.`}
        >
          <span
            title={`${b.version} won ${result.b} pairs`}
            className="h-full rounded-l-[4px] bg-(--arena-b)"
            style={{ width: `${bShare}%` }}
          />
          <span
            title={`${a.version} won ${result.a} pairs`}
            className="h-full flex-1 rounded-r-[4px] bg-(--arena-a)"
          />
        </div>
        <span
          aria-hidden="true"
          className="absolute bottom-[-4px] top-5 w-px bg-(--ink)"
          style={{ left: `${neededAt}%` }}
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-2 text-(--ink)">
          <SideDot side="B" />
          <span className="font-mono">{b.version}</span>
          <span className="tabular-nums">{result.b}</span>
        </span>
        <span className="text-(--ink-2)">{result.ties} ties, not counted</span>
        <span className="inline-flex items-center gap-2 text-(--ink)">
          <span className="tabular-nums">{result.a}</span>
          <span className="font-mono">{a.version}</span>
          <SideDot side="A" />
        </span>
      </figcaption>
    </figure>
  )
}

export function RoundResult({ round, result }: { round: ArenaRound; result: ArenaResult }) {
  return (
    <Panel as="section" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-(--ink-2)">Decided by the jury on {round.dates.closed}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-(--ink)">{result.headline}</h2>
        <p className="max-w-[60ch] text-(--ink-2)">{result.summary}</p>
      </div>
      <TallyBar round={round} result={result} />
      <p className="text-sm text-(--ink-2)">{result.next}</p>
    </Panel>
  )
}

function PickCell({ pick, round, strong }: { pick?: Pick; round: ArenaRound; strong?: boolean }) {
  if (!pick) return <span className="text-(--ink-2)">-</span>
  if (pick === 'tie') return <span className="text-(--ink-2)">Tie</span>
  const v = round.versions[pick === 'A' ? 0 : 1]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono',
        strong ? 'font-semibold text-(--ink)' : 'text-(--ink-2)',
      )}
    >
      <SideDot side={pick} className="size-2" />
      {v.version}
    </span>
  )
}

export function PairsTable({ round }: { round: ArenaRound }) {
  return (
    <div className="flex flex-col gap-3">
      <Panel padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-(--line) text-left">
              {['#', 'Brief', 'Jury', 'Holders', 'Machines', 'Public'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.06em] text-(--ink-2)"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--line)">
            {round.pairs.map((p) => (
              <tr key={p.n}>
                <td className="px-4 py-3 font-mono tabular-nums text-(--ink-2)">{p.n}</td>
                <td className="px-4 py-3">
                  <span className="font-medium text-(--ink)">{p.site}</span>
                  <span className="block text-xs text-(--ink-2)">{p.brief}</span>
                </td>
                <td className="px-4 py-3">
                  <PickCell pick={p.picks?.jury} round={round} strong />
                </td>
                <td className="px-4 py-3">
                  <PickCell pick={p.picks?.holders} round={round} />
                </td>
                <td className="px-4 py-3">
                  <PickCell pick={p.picks?.machines} round={round} />
                </td>
                <td className="px-4 py-3">
                  <PickCell pick={p.picks?.public} round={round} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="text-sm text-(--ink-2)">
        Showing {round.pairs.length} of {round.pairCount} pairs in this preview. Every vote is
        published with its signature.
      </p>
    </div>
  )
}

function CardFooter({ round }: { round: ArenaRound }) {
  if (round.status === 'open') {
    const jury = round.juries.find((j) => j.kind === 'jury')
    const holders = round.juries.find((j) => j.kind === 'holders')
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-(--ink-2)">
          Closes {round.dates.closes}
          {jury ? ` · ${jury.voters} of ${jury.of} jury` : ''}
          {holders ? ` · ${numberFormat.format(holders.voters)} holders` : ''}
        </p>
        <Button href={voteHref(round.slug)} size="md">
          Vote
        </Button>
      </div>
    )
  }
  if (round.status === 'upcoming') {
    return (
      <p className="text-sm text-(--ink-2)">
        {round.judgedBy === 'planted-bugs'
          ? 'Judged by planted bugs. Nobody votes.'
          : 'People vote once it locks.'}
      </p>
    )
  }
  if (!round.result) return null
  return (
    <p className="flex flex-wrap items-center gap-3 text-sm text-(--ink-2)">
      <VerdictBadge result={round.result} />
      {round.result.summary}
    </p>
  )
}

export function RoundCard({ round }: { round: ArenaRound }) {
  return (
    <Panel
      as="article"
      className="flex flex-col gap-4 transition-colors hover:border-[color-mix(in_srgb,var(--line)_60%,var(--ink-2))]"
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.06em] text-(--ink-2)">
          {round.network} · {round.area}
        </span>
        <span className="ml-auto">
          <StatusBadge round={round} />
        </span>
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-(--ink)">
          <Link href={roundHref(round.slug)} className="hover:underline hover:underline-offset-4">
            {round.title}
          </Link>
        </h2>
        <p className="mt-1 text-(--ink-2)">{round.question}</p>
      </div>
      <VersionLine round={round} />
      <div className="border-t border-(--line) pt-4">
        <CardFooter round={round} />
      </div>
    </Panel>
  )
}

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Lock', body: 'Both versions are frozen by hash before anything runs.' },
  { title: 'Build twice', body: 'Real briefs, one build per version. Same model and tools.' },
  { title: 'Judge blind', body: 'People pick the better result without knowing which is which.' },
  { title: 'Publish', body: 'Every vote is signed and published. Winning twice makes it proven.' },
]

export function HowRoundsWork() {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step, i) => (
        <li key={step.title} className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-(--ink)">
            <span className="inline-grid size-5 place-items-center rounded-full bg-(--ink) font-mono text-2xs [color:var(--surface)]">
              {i + 1}
            </span>
            {step.title}
          </p>
          <p className="text-sm leading-relaxed text-(--ink-2)">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}

export function PreviewNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-(--line) px-4 py-2.5 text-sm text-(--ink-2)">
      {children ?? 'Preview. The rounds, votes and results here are example data.'}
    </p>
  )
}
