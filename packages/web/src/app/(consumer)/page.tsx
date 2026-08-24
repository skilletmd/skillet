import { ClaudeLogo, CursorLogo, OpenAiLogo } from '@/components/brand-logos'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { CommandBlock } from '@/components/command-block'
import { HomeCatalogShelves, HomeBlogShelf, HomeActivityRail } from '@/components/home/home-shelves'
import { SummonDemo, InstallBox } from '@/components/home/install-steps'
import { SummonLine } from '@/components/home/summon-line'
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
const HOME_SHARE_TITLE = "Summon anyone's genius · Skillet"
const HOME_SHARE_DESCRIPTION =
  "Type a name and borrow their brain. Run anyone's public skills in your agent, and keep your own current everywhere."

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

// The borrow band. One action, and it costs nothing: `SummonLine` replaced the
// install box that used to sit here. The headline promises borrowing, so an
// install box under it argued against the sentence above it, and it fired six
// CTAs at a visitor before the catalog had said who is on Skillet at all.
// Install moved to the adopt band at the bottom of the page.
//
// (The older note here explained why there is no CTA row under the box: both
// destinations already sit in the header on every page, and dropping it removed
// the page's only auth() call so the whole hero prerenders. Still true, and now
// also true of the band as a whole.)
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-(--line)">
      <div className="hero-glow absolute inset-0" />
      <div className="relative mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-[clamp(40px,6vw,72px)]">
        <div className="grid items-center gap-x-12 gap-y-10 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <h1 className="hero-title leading-[1.03]">Summon anyone&apos;s genius.</h1>
            <p className="mx-auto mt-3 max-w-[40ch] text-xl leading-[1.4] text-(--ink-2) sm:text-2xl lg:mx-0">
              Borrow anyone&apos;s whole library for one task.
            </p>
            <SummonLine />
          </div>
          <SummonDemo />
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

// The adopt band. One action, and the argument for taking it.
//
// This replaced a three-column ladder of peers: Get app / See feed / Set up
// teams. Three equal buttons is not a sequence, the order ran adopt, discover,
// team (backwards against the funnel), and the lead card, "Bring your skills
// everywhere", talked about skills a first-time visitor does not have yet. The
// discover third of it is the catalog above, which makes the same point with
// real people in it, so only the adopt third survives here.
//
// The argument is the two lines side by side. The hero's borrow line works in
// any agent and costs a paste every time; installed, the same thing is four
// words the agent reaches for on its own. Nobody has to be told installing is
// worth it once they can see both.
function AdoptBand() {
  return (
    <section className="border-t border-(--line)">
      <div className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-[clamp(40px,6vw,64px)]">
        <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-2">
          <div>
            <div className="flex h-11 items-center">
              <PublishMotif />
            </div>
            <h2 className="mt-6 text-2xl font-semibold leading-snug text-(--ink)">
              Keep what you borrow
            </h2>
            <p className="mt-3 max-w-[48ch] text-base leading-[1.55] text-(--ink-2)">
              Install once and summoning is four words, in every agent on every machine, with the
              agent reaching for the right skill on its own. Updates from the people you follow
              arrive as a diff you approve.{' '}
              <Link
                href="/settings/teams"
                className="font-medium text-(--ink) underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--accent)"
              >
                Teams share one set
              </Link>
              , with versioning on every change.
            </p>
            <div className="mt-6">
              <CommandBlock
                command="/skillet @mattpocock review my PR"
                accent="@mattpocock"
                prompt={null}
                size="sm"
                wrap
                bare
              />
            </div>
          </div>
          <InstallBox />
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
            <HomeBlogShelf />
          </div>
          <aside className="surface-aside">
            <div className="surface-aside-stack">
              <Suspense fallback={null}>
                <HomeActivityRail />
              </Suspense>
            </div>
          </aside>
        </div>
      </div>

      <AdoptBand />
    </main>
  )
}
