import { ClaudeLogo, CursorLogo, OpenAiLogo } from '@/components/brand-logos'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense, type ComponentType } from 'react'
import { CommandBlock } from '@/components/command-block'
import { HomeCatalogShelves, HomeBlogRail, HomeActivityRail } from '@/components/home/home-shelves'
import { SummonDemo } from '@/components/home/install-steps'
import { InstallActions } from '@/components/install/install-picker'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { CoverArt } from '@/components/cover/cover'
import { CatalogShelvesSkeleton } from '@/components/home/shelf-skeleton'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { ogMeta, OG } from '@/lib/og'
import { GITHUB_REPO_URL } from '@/lib/urls'
import { markdownAlternates } from '@/lib/markdown-alternate'
import { HOME_JSON_LD } from '@/lib/home-json-ld'

const HOME_OG = ogMeta(OG.home())

// Search line and share line are different jobs, so they say different things:
// the <title>/description name the runtimes people query for (the layout's brand
// title, inherited before this, named none of them), while the OG/Twitter pair
// keeps the pitch a shared link should lead with. Hero copy is untouched.
const HOME_SHARE_TITLE = "Genius on tap · Skillet"
const HOME_SHARE_DESCRIPTION =
  "You pick the person, your agent picks the skill. Tag anyone on Skillet and their whole public library is available in the agent you already use."

export const metadata: Metadata = {
  title: 'Skillet · Skills for Claude Code, Codex, and Cursor',
  description:
    "Summon anyone's genius: type a name and run their public skills in Claude Code, Codex, or Cursor. Publish your own once and keep every agent in sync.",
  // The same URL serves clean Markdown to `Accept: text/markdown`, which is the
  // representation an agent actually wants. `Vary: Accept` told caches that;
  // nothing told the client the twin existed. This does, in the document
  // itself, where it survives Next's header rewriting on a prerendered page.
  alternates: markdownAlternates('/'),
  ...HOME_OG,
  openGraph: { ...HOME_OG.openGraph, title: HOME_SHARE_TITLE, description: HOME_SHARE_DESCRIPTION },
  twitter: { ...HOME_OG.twitter, title: HOME_SHARE_TITLE, description: HOME_SHARE_DESCRIPTION },
}

// The hero. One action group: the four doors, the same component the kit page
// uses, so "where do I put this" has one answer everywhere it is asked.
//
// The copyable summon line that briefly lived here moved to the ladder at the
// bottom, next to the reasons to install. It argues for itself better beside
// them than above them: the visitor can see what borrowing costs every time
// against what installing costs once.
//
// Still no CTA row under it: both destinations sit in the header on every page,
// and the hero reads no session, so the whole band prerenders. `InstallActions`
// with signedIn=false renders the cloud doors as links to /docs/mcp rather than
// panels that call a server action, which is what keeps that true.
// Narrower than the column it sits in. 560px left the longest label, "Download
// for Mac", trailing most of its cell, so the four buttons read as four wide
// bars rather than four options. Sized to the content plus breathing room, and
// still flush left with the headline above.
function HeroInstall() {
  return (
    <div className="mx-auto w-full max-w-[480px] lg:mx-0">
      <p className="text-sm font-medium text-(--ink)">
        Install Skillet where you want to use it:
      </p>
      <div className="mt-3">
        {/* Two by two: the hero column is half of a 1120px grid, so four
            content-sized buttons cannot share a line and a flex wrap strands
            the fourth one. */}
        <InstallActions layout="pairs" />
      </div>
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-(--line)">
      <div className="hero-glow absolute inset-0" />
      <div className="relative mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-[clamp(40px,6vw,72px)]">
        {/* Three children, placed explicitly on lg.
            On a phone the single column follows source order, which is the
            order the argument needs: say it, SHOW it, then ask. On desktop the
            demo sits beside the copy, so the visitor reads what it does while
            the ask is already in view; stacking install first on mobile threw
            that away and asked before explaining anything. Explicit row/column
            placement rebuilds the two-column arrangement without rendering the
            install block twice. */}
        <div className="grid items-center gap-x-12 gap-y-10 lg:grid-cols-2">
          <div className="text-center lg:col-start-1 lg:row-start-1 lg:text-left">
            {/* The claim, then the keystroke. No competitor in it.
                Naming the category we are not ("not a leaderboard", "900,000
                skills") argues with someone who is not in the room: a cold
                visitor has usually never heard of a skill directory, and a
                headline that defends against one reads as defensive rather than
                confident. The differentiating work moves to the subhead and to
                the demo beside it, both of which show a HANDLE as the unit,
                which is the actual difference.

                "Tag" carries the mechanic without the sigil: everyone already
                knows what tagging a person means, and a line opening on `@`
                reads as a fragment and is announced as "at anyone". The demo
                beside this shows the literal `/skillet @handle`, so the syntax
                is taught there rather than spent here. "You trust" is the POV:
                the unit is a person you already rate, not a rank.

                One line. The parallel carries itself at this length without a
                forced break, and the wider measure keeps it from wrapping on a
                desktop hero at all.

                The real barrier to skills is not supply, it is decision. People
                do not know which skill, when, or how to get it, and a directory
                of hundreds of thousands makes that worse. So the promise is
                that the choice is not theirs to make: they bring a name, the
                agent brings the judgment. It also states the difference without
                arguing with anyone, since a catalog cannot say it. */}
            <h1 className="hero-title leading-[1.03]">Genius on tap.</h1>
            <p className="mx-auto mt-3 max-w-[52ch] text-xl leading-[1.4] text-(--ink-2) sm:text-2xl lg:mx-0">
              You pick the person. Your agent picks the skill.
            </p>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <SummonDemo />
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <HeroInstall />
          </div>
        </div>
      </div>
    </section>
  )
}

// The agent-logo cluster: "every AI tool", in the product's own visual
// language. Its two siblings (kit covers for the feed, a facepile for teams)
// went with the ladder cards they belonged to.
const FRAME =
  'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden ring-2 ring-(--bg)'

function PublishMotif() {
  const agents = [
    { name: 'Claude', Logo: ClaudeLogo },
    { name: 'ChatGPT', Logo: OpenAiLogo },
    { name: 'Cursor', Logo: CursorLogo },
  ]
  return (
    <div className="flex -space-x-2.5">
      {agents.map(({ name, Logo }) => (
        <span
          key={name}
          className={`${FRAME} rounded-full border border-(--line) bg-(--surface) text-(--ink)`}
        >
          <Logo className="h-5 w-5" />
        </span>
      ))}
    </div>
  )
}

// The closing ladder: three boxes, read after the catalog rather than before it.
//
// It ran as a three-column band above the catalog once and was cut, because
// three equal buttons is not a sequence and the order inverted the funnel. Down
// here that objection is gone: the visitor has already seen who is on Skillet,
// so these are answers to a question they have actually formed rather than
// three doors fired at a stranger.
//
// The lead rung used to be "Get app", which now duplicates the Mac app door in
// the hero. It answers what installing BUYS instead: one kit in every agent.
// A "borrow with nothing installed" rung sat here briefly and argued with the
// hero directly above it, which now asks for an install; that is the same
// contradiction the hero itself had last night, moved down a screen.
function SyncMotif() {
  const kits = ['frontend', 'design', 'marketing']
  return (
    <div className="flex -space-x-2.5">
      {kits.map((cat) => (
        <span
          key={cat}
          className={`${FRAME} relative rounded-xl border border-(--line) ring-[3px]`}
        >
          <CoverArt seed={`ladder-kit-${cat}`} categories={[cat]} className="h-full w-full" />
          {/* subtle dark inner edge so the art reads as framed on any color,
              without the heavy white halo a light ring gives on saturated art */}
          <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10" />
        </span>
      ))}
    </div>
  )
}

function TeamsMotif() {
  const team = ['ada', 'lin', 'jo']
  return (
    <div className="flex -space-x-2.5">
      {team.map((k) => (
        <Avatar
          key={k}
          name={k}
          colorKey={k}
          size="md"
          className="border border-(--line) ring-2 ring-(--bg)"
        />
      ))}
    </div>
  )
}

const LADDER: ReadonlyArray<{
  title: string
  body: string
  href: string
  cta: string
  Motif: ComponentType
}> = [
  {
    title: 'One kit, every agent',
    body: 'Claude Code, Cursor, Codex, ChatGPT and six more. Add a skill once and it is there in all of them, on every machine.',
    href: '/docs/runtimes',
    cta: 'See the runtimes',
    Motif: PublishMotif,
  },
  {
    title: 'New skills from people you trust',
    body: 'Follow experts and friends. Their latest skills show up in your feed, one click to add.',
    href: '/feed',
    cta: 'See feed',
    Motif: SyncMotif,
  },
  {
    title: 'Keep your team in sync',
    body: 'One shared set of skills, with approval and versioning on every change.',
    href: '/settings/teams',
    cta: 'Set up teams',
    Motif: TeamsMotif,
  },
]

function HomeLadder() {
  return (
    <section className="border-t border-(--line)">
      <div className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)]">
        <div className="grid divide-y divide-(--line) border-x border-(--line) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {LADDER.map((r) => (
            <div key={r.title} className="flex flex-col items-start py-8 sm:px-8">
              <div className="flex h-11 items-center">
                <r.Motif />
              </div>
              <h2 className="mt-6 text-lg font-semibold leading-snug text-(--ink)">{r.title}</h2>
              <p className="mt-3 text-sm leading-[1.55] text-(--ink-2) sm:min-h-[5.5rem]">
                {r.body}
              </p>
              <Button href={r.href} variant="secondary" size="md" className="group mt-7">
                {r.cta}
                <span
                  aria-hidden="true"
                  className="transition-transform duration-200 [@media(hover:hover)]:group-hover:translate-x-0.5"
                >
                  &rarr;
                </span>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// The logged-in → /feed redirect lives in middleware (src/middleware.ts) so it
// runs before any render — redirecting from this page after the PPR shell starts
// streaming throws a React "boundaries flushed again" error. At `/` this page
// therefore only renders for logged-out visitors and crawlers (signed-in users
// can still reach it via the /home alias): a curated teaser (hero, 3 featured
// kits, two top-5 lists, blog) that links into /browse for the full catalog.
// Kept a static shell + dynamic Suspense holes (no force-dynamic) so it
// prerenders for crawlers. The page itself reads no session: the hero is fully
// static, and the remaining Suspense holes are catalog data, not auth.
export default function Home() {
  return (
    <main className="marketing-home consumer-theme">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_JSON_LD) }}
      />
      <Hero />

      {/* Discover, before adopt: the catalog answers "who is on here", which is
          the question a stranger has after the hero and before any reason to
          install exists. It used to sit below the feature grid. */}
      <div className={PAGE_CONTAINER_CLASS}>
        <div className="surface-grid">
          <div className="surface-main">
            <Suspense fallback={<CatalogShelvesSkeleton kitCount={3} chartSize={5} />}>
              <HomeCatalogShelves
                viewerHandle={null}
                kitCount={3}
                chartSize={5}
                showNewlyPublished={false}
              />
            </Suspense>
          </div>
          <aside className="surface-aside">
            <div className="surface-aside-stack">
              <Suspense fallback={null}>
                <HomeActivityRail />
              </Suspense>
              {/* Under the activity, not above it: activity is live and the
                  reason to keep glancing at the rail; the blog is evergreen. */}
              <HomeBlogRail />
            </div>
          </aside>
        </div>
      </div>

      <HomeLadder />
    </main>
  )
}
