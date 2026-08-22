import { ClaudeLogo, CursorLogo, OpenAiLogo } from '@/components/brand-logos'
import type { Metadata } from 'next'
import { Suspense, type ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { CoverArt } from '@/components/cover/cover'
import { HomeCatalogShelves, HomeBlogShelf, HomeActivityRail } from '@/components/home/home-shelves'
import { SummonDemo, InstallBox } from '@/components/home/install-steps'
import { GetAppButton } from '@/components/home/get-app-button'
import { CatalogShelvesSkeleton } from '@/components/home/shelf-skeleton'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { ogMeta, OG } from '@/lib/og'
import { GITHUB_REPO_URL } from '@/lib/urls'

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
  alternates: { canonical: '/' },
  ...HOME_OG,
  openGraph: { ...HOME_OG.openGraph, title: HOME_SHARE_TITLE, description: HOME_SHARE_DESCRIPTION },
  twitter: { ...HOME_OG.twitter, title: HOME_SHARE_TITLE, description: HOME_SHARE_DESCRIPTION },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

/** Public support address for structured data. Unset by default — see the
 *  contactPoint note below. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null

// Organization + WebSite in one graph. The SearchAction is what makes Google
// eligible to show a sitelinks search box for the brand query, and the
// Organization node is what feeds the knowledge panel / AI-answer attribution.
const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'Skillet',
      url: SITE_URL,
      logo: `${SITE_URL}/brand/skillet-mascot-logo.png`,
      description:
        'A registry for agent skills: publish a skill once, run it in every agent runtime.',
      sameAs: [GITHUB_REPO_URL],
      // How to reach a human, in the field AI answer engines read to verify a
      // business is real. `email` is opt-in via NEXT_PUBLIC_CONTACT_EMAIL: the
      // rest of the site renders addresses through ObfuscatedEmail on purpose,
      // so publishing one into structured data has to be a deliberate choice,
      // not a side effect of adding schema.
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          url: `${SITE_URL}/contact`,
          availableLanguage: ['English'],
          ...(CONTACT_EMAIL ? { email: CONTACT_EMAIL } : {}),
        },
        {
          '@type': 'ContactPoint',
          contactType: 'technical support',
          url: `${GITHUB_REPO_URL}/issues`,
          availableLanguage: ['English'],
        },
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'Skillet',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

// No CTA row under the install box. It only ever rendered for signed-in
// viewers, and both of its destinations (Browse, and the wordmark to Feed) sit
// in the header on every page, so it duplicated persistent chrome while
// competing with the install command for the eye. Dropping it also removes the
// page's only auth() call, which lets the whole hero prerender.
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-(--line)">
      <div className="hero-glow absolute inset-0" />
      <div className="relative mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-[clamp(40px,6vw,72px)]">
        <div className="grid items-center gap-x-12 gap-y-10 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <h1 className="hero-title leading-[1.03]">Summon anyone&apos;s genius.</h1>
            <p className="mx-auto mt-3 max-w-[40ch] text-xl leading-[1.4] text-(--ink-2) sm:text-2xl lg:mx-0">
              @ their name to borrow their brain.
            </p>
            <InstallBox />
          </div>
          <SummonDemo />
        </div>
      </div>
    </section>
  )
}

// Rungs 2-4 of the ladder (rung 1, summon, is the hero). Kept below the proof
// (featured kits) as a single quiet band: progressive disclosure down the page
// so a scroller gets the full story without it crowding the summon hero.
// Each pillar's mark IS its concept, in the product's own visual language:
// the agent logos (every AI tool), kit covers (new skills in your feed), a
// facepile (your team). Presented identically — same overlapping circular cluster — so the row
// reads as one set instead of three different shapes.
const FRAME =
  'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden ring-2 ring-(--bg)'

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
    title: 'Bring your skills everywhere',
    body: 'The desktop app keeps your skills backed up and synced across every agent and machine.',
    href: '/download',
    cta: 'Get app',
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
    <section className="border-b border-(--line)">
      <div className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)]">
        <div className="grid divide-y divide-(--line) border-x border-(--line) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {LADDER.map((r) => (
            <div key={r.href} className="flex flex-col items-start py-8 sm:px-8">
              <div className="flex h-11 items-center">
                <r.Motif />
              </div>
              <h2 className="mt-6 text-lg font-semibold leading-snug text-(--ink)">{r.title}</h2>
              <p className="mt-3 text-sm leading-[1.55] text-(--ink-2) sm:min-h-[2.75rem]">
                {r.body}
              </p>
              {r.href === '/download' ? (
                <GetAppButton href={r.href} label={r.cta} className="mt-7" />
              ) : (
                <Button href={r.href} variant="secondary" size="md" className="group mt-7">
                  {r.cta}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 [@media(hover:hover)]:group-hover:translate-x-0.5"
                  >
                    &rarr;
                  </span>
                </Button>
              )}
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

      <HomeLadder />

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
    </main>
  )
}
