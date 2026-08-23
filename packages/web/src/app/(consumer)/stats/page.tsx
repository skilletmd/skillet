import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getRegistryStats } from '@/lib/registry'
import type { RegistryStats } from '@/lib/registry'
import { safe } from '@/components/home/home-shared'
import { StatSection, type Stat } from '@/components/stats/stat-grid'
import { GrowthChart } from '@/components/stats/growth-chart'
import { CategoryBars } from '@/components/stats/category-bars'
import { Panel } from '@/components/ui/panel'
import { buttonClasses } from '@/components/ui/button'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { PageIntro } from '@/components/page-intro'
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
    versions: [],
    subscriptions: [],
    follows: [],
  },
  categories: [],
  routes: {
    invocations: 0,
    picks: 0,
    summons: 0,
    topPickedSkills: [],
    invocationsByRuntime: [],
  },
}

const numberFormat = new Intl.NumberFormat('en-US')

// Two stories, in order: momentum (the rates that compound) then network depth
// (the supply + graph that make it defensible). Each card carries its own
// sparkline + MoM delta, so the group reads as a trend, not a tally.
function momentumCards(stats: RegistryStats): Stat[] {
  const { totals: t, series } = stats
  return [
    {
      id: 'installs',
      label: 'Installs',
      value: t.installs,
      hint: 'skills run across every agent',
      series: series.installs,
    },
    {
      id: 'skills',
      label: 'Public skills',
      value: t.skills,
      hint: 'published and shareable',
      series: series.skills,
    },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      value: t.subscriptions,
      hint: 'standing follows of kits + creators',
      series: series.subscriptions,
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

function networkCards(stats: RegistryStats): Stat[] {
  const { totals: t, series } = stats
  return [
    {
      id: 'creators',
      label: 'Creators',
      value: t.creators,
      hint: 'shipping public skills',
      series: series.creators,
    },
    {
      id: 'kits',
      label: 'Kits',
      value: t.kits,
      hint: 'curated, sharable skill sets',
      series: series.kits,
    },
    {
      id: 'versions',
      label: 'Versions published',
      value: t.versions,
      hint: 'total publishes, all time',
      series: series.versions,
    },
    {
      id: 'connections',
      label: 'Connections',
      value: t.follows,
      hint: 'edges in the trust graph',
      series: series.follows,
    },
  ]
}

function routeCards(stats: RegistryStats): Stat[] {
  return [
    {
      id: 'route-invocations',
      label: '/skillet invocations',
      value: stats.routes.invocations,
      hint: 'times the command was invoked',
    },
    {
      id: 'route-picks',
      label: 'Skills picked',
      value: stats.routes.picks,
      hint: 'successful route selections',
    },
    {
      // Summons are the no-install path, so they are counted server-side
      // rather than from CLI events like the two cards above.
      id: 'route-summons',
      label: 'Summons',
      value: stats.routes.summons,
      hint: "someone's kit run without installing it",
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
      <GrowthChart growth={stats.growth} />

      <StatSection label="Activity" stats={momentumCards(stats)} />

      <StatSection label="Community" stats={networkCards(stats)} />

      <StatSection label="Routing" stats={routeCards(stats)} />

      <TopPickedSkills stats={stats} />

      <InvocationsByRuntime stats={stats} />

      <CategoryBars categories={stats.categories} />
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-hidden>
      <Panel padding="none" className="h-72 animate-pulse" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Panel key={i} padding="none" className="h-30 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export default function StatsPage() {
  return (
    <main className={PAGE_CONTAINER_CLASS}>
      <header>
        <PageIntro
          eyebrow="Open data"
          title="Skillet by the numbers"
          lede="Live counts from the registry: skills, kits, installs, and the people behind them. Updated continuously."
        />
      </header>

      <div className="mt-10">
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
