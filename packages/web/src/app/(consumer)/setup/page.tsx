import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getFollowSuggestions, getSkill } from '@/lib/registry'
import { parseKitSkillRef } from '@/lib/kits'
import { SetupFlow, type FeaturedPick } from '@/components/setup/setup-flow'
import { detectInstallPlatform } from '@/lib/install-platform'
import { PAGE_CONTAINER_NARROW_CLASS } from '@/lib/page-layout'
import { PageIntro } from '@/components/page-intro'

export const metadata = { title: 'Set up Skillet' }

// First-run guided picks. Existing published skills only — no auto-seed.
// Curation is a content decision; swap these freely.
const FEATURED_PICKS: FeaturedPick[] = [
  {
    refName: '@skillet/skillet-onboarding',
    title: 'How Skillet works',
    blurb: 'Teaches your agent to find, add, and publish skills.',
  },
  {
    refName: '@skillet/write-a-skill',
    title: 'Write a skill',
    blurb: 'The craft of authoring a good SKILL.md.',
  },
]

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>
}) {
  // Dev-only preview switch, never active in production:
  //   ?preview=2 → the guided chat running its scripted (fake-data) demo.
  // Real signed-in users get the guided chat wired to live data.
  const sp = await searchParams
  const isDev = process.env.NODE_ENV !== 'production'
  const scriptedPreview = isDev && sp.preview === '2'

  // Golden path: you must be signed in (account created on the web). The
  // pair-code / "connect this browser" paths remain available from /login.
  const session = await auth()
  if (!scriptedPreview && !session?.user) {
    redirect('/login?callbackUrl=/setup')
  }

  const suggestions = await getFollowSuggestions().catch(() => [])

  // Detect OS from the request UA so the download CTA leads with the right app
  // on first paint; the client refines it on mount.
  const initialPlatform = detectInstallPlatform((await headers()).get('user-agent') ?? '', '')

  // In live mode, only surface picks that actually resolve in the registry — a
  // dead Add button would stall the guided flow (the chat advances on a
  // successful add, which never fires for an unpublished ref). The scripted
  // preview keeps the full list so the demo isn't gated on what's published.
  const liveFeatured = scriptedPreview
    ? FEATURED_PICKS
    : (
        await Promise.all(
          FEATURED_PICKS.map(async (pick) => {
            const parsed = parseKitSkillRef(pick.refName)
            if (!parsed) return null
            const skill = await getSkill(parsed.author, parsed.slug).catch(() => null)
            return skill ? pick : null
          }),
        )
      ).filter((p): p is FeaturedPick => p !== null)

  // Chat-led onboarding: a compact, centered, self-scrolling conversation.
  // `live` drives the real pair code / device polling / materialization wiring;
  // the scripted preview runs the same UI on canned data.
  return (
    <main className={PAGE_CONTAINER_NARROW_CLASS}>
      <PageIntro eyebrow="Setup" title="Let’s get your skills everywhere" />
      <div className="mt-6">
        <SetupFlow
          featured={liveFeatured}
          suggestions={suggestions}
          live={!scriptedPreview}
          initialPlatform={initialPlatform}
        />
      </div>
    </main>
  )
}
