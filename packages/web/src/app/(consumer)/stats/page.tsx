import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getRegistryStats } from '@/lib/registry'
import type { RegistryStats } from '@/lib/registry'
import { safe } from '@/components/home/home-shared'
import { StatGrid, type Stat } from '@/components/stats/stat-grid'
import { CategoryBars } from '@/components/stats/category-bars'
import { Panel } from '@/components/ui/panel'
import { buttonClasses } from '@/components/ui/button'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { PageHeader } from '@/components/page-header'
import { ogMeta, OG } from '@/lib/og'

export const metadata: Metadata = {
  title: 'Skillet by the numbers: public stats',
  description:
    'Live, public data on the Skillet registry: skills, kits, installs, creators, and growth over time.',
  ...ogMeta(OG.stats()),
}

const EMPTY_STATS: RegistryStats = {
  totals: {
    users: 0,
    creators: 0,
    skills: 0,
    networkSkills: 0,
    kits: 0,
    installs: 0,
    saves: 0,
    versions: 0,
    subscriptions: 0,
    follows: 0,
  },
  growth: [],
  months: [],
  series: {
    users: [],
    creators: [],
    skills: [],
    networkSkills: [],
    kits: [],
    installs: [],
    saves: [],
    versions: [],
    subscriptions: [],
    follows: [],
  },
  categories: [],
  routes: {
    invocations: 0,
    picks: 0,
    summons: 0,
    routed: 0,
    routedSeries: [],
    topPickedSkills: [],
    invocationsByRuntime: [],
  },
}

const numberFormat = new Intl.NumberFormat('en-US')

// One grid, six numbers, in two rows the reader can follow: what is on the
// network (skills, kits, creators), then what people do with it (installs,
// routes, members). Each card carries its own sparkline + MoM delta and opens
// its full chart.
//
// Deliberately absent: versions published (publishing churn, not a signal a
// reader can use), trust-graph edges, and subscriptions (a weaker restatement
// of the adoption the first two usage cards already carry). Six real numbers
// beat eight with filler.
function statCards(stats: RegistryStats): Stat[] {
  const { totals: t, series } = stats
  return [
    {
      id: 'skills',
      label: 'Public skills',
      value: t.skills,
      hint: 'published and shareable',
      series: series.skills,
    },
    {
      id: 'kits',
      label: 'Kits',
      value: t.kits,
      hint: 'curated, sharable skill sets',
      series: series.kits,
    },
    {
      id: 'creators',
      label: 'Creators',
      value: t.creators,
      hint: 'shipping public skills',
      series: series.creators,
    },
    {
      // The person, counted once per skill: saved into one of their kits, or
      // brought in by a kit or author subscription. `totals.installs` is
      // deliberately not shown - it counts a ping per machine that materializes
      // the skill, so syncing to four laptops reads as four, which is a device
      // number wearing a demand number's label.
      id: 'saves',
      label: 'Saves',
      value: t.saves,
      hint: 'skills saved by users',
      series: series.saves,
    },
    {
      // Routing's one public number: picks plus summons. The three cards this
      // replaced described the plumbing, not the outcome; the detail panels
      // further down the page still carry it.
      id: 'routed',
      label: 'Skills routed',
      value: stats.routes.routed,
      hint: 'used through /skillet',
      series: stats.routes.routedSeries,
    },
    {
      id: 'members',
      label: 'Members',
      value: t.users,
      hint: 'with a claimed handle',
      series: series.users,
    },
  ]
}

function InvocationsByRuntime({ stats }: { stats: RegistryStats }) {
  const rows = stats.routes.invocationsByRuntime ?? []
  if (rows.length === 0) {
    return null
  }

  return (
    <Panel as="section" padding="none" className="p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-(--ink)">
          Invocations by runtime
        </h2>
        <p className="text-sm text-(--ink-2)">Where /skillet was invoked</p>
      </div>
      <ol className="mt-5 divide-y divide-(--line)">
        {rows.map((row) => (
          <li key={row.runtime} className="flex items-center justify-between gap-4 py-3">
            <span className="font-mono text-sm text-(--ink)">{row.runtime}</span>
            <span className="shrink-0 rounded-full bg-(--card-soft) px-3 py-1 text-sm font-medium tabular-nums text-(--ink)">
              {numberFormat.format(row.count)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function TopPickedSkills({ stats }: { stats: RegistryStats }) {
  const top = stats.routes.topPickedSkills
  if (top.length === 0) {
    return (
      <Panel as="section" padding="none" className="p-6">
        <h2 className="text-xl font-semibold tracking-tight text-(--ink)">Top routed skills</h2>
        <p className="mt-2 text-sm text-(--ink-2)">No routed skill picks recorded yet.</p>
      </Panel>
    )
  }

  return (
    <Panel as="section" padding="none" className="p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-(--ink)">Top routed skills</h2>
        <p className="text-sm text-(--ink-2)">Top 10 by successful picks</p>
      </div>
      <ol className="mt-5 divide-y divide-(--line)">
        {top.map((skill, index) => (
          <li key={skill.skillRef} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <span className="mr-3 text-sm tabular-nums text-(--ink-3)">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="font-mono text-sm text-(--ink)">{skill.skillRef}</span>
            </div>
            <span className="shrink-0 rounded-full bg-(--card-soft) px-3 py-1 text-sm font-medium tabular-nums text-(--ink)">
              {numberFormat.format(skill.picks)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

async function StatsContent() {
  const stats = await safe(getRegistryStats(), EMPTY_STATS)

  return (
    <div className="flex flex-col gap-12">
      <StatGrid stats={statCards(stats)} months={stats.months} />

      <TopPickedSkills stats={stats} />

      <InvocationsByRuntime stats={stats} />

      <CategoryBars categories={stats.categories} />
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-hidden>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Panel key={i} padding="none" className="h-30 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export default function StatsPage() {
  return (
    <main className={PAGE_CONTAINER_CLASS}>
      <PageHeader
        title="Skillet by the numbers"
        lede="Live counts from the registry, updated continuously."
      />

      <div className="mt-8">
        <Suspense fallback={<StatsSkeleton />}>
          <StatsContent />
        </Suspense>
      </div>

      <Panel as="section" padding="none" className="mt-16 bg-(--card-soft) p-8 text-center sm:p-10">
        <h2 className="text-2xl font-semibold tracking-tight text-(--ink)">
          Add your skills to the count.
        </h2>
        <p className="mx-auto mt-2 max-w-[44ch] text-(--ink-2)">
          Publish a skill, build a kit, and sync it to every agent you run.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login?mode=signup" className={buttonClasses('primary')}>
            Get started
          </Link>
          <Link href="/browse/all" className={buttonClasses('secondary')}>
            Browse skills
          </Link>
        </div>
      </Panel>
    </main>
  )
}
