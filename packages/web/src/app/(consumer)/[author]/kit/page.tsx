import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/auth'
import { getAuthorKit, getKitCapabilities } from '@/lib/kits-server'
import { authorKitTagline } from '@/lib/author-kit'
import { KitCoverStack } from '@/components/kit-card'
import { SubscribeAuthorButton } from '@/components/kits/subscribe-author-button'
import { Button } from '@/components/ui/button'
import { UsedBy } from '@/components/kits/used-by'
import { KitPageLayout } from '@/components/kits/kit-page-layout'

interface Params {
  author: string
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { author } = await params
  const result = await getAuthorKit(author)
  if (result.kind !== 'ok') return {}
  const kit = result.kit
  return {
    title: `${kit.name}’s skills · Skillet`,
    description: `Every public skill by @${kit.owner}. Add to keep them synced.`,
  }
}

/**
 * Author-kit page — the virtual "everything @author publishes" kit. Renders the
 * shared {@link KitPageLayout}, the same shell a named kit uses, so the two can't
 * drift. Only the specifics differ: the cover is the author's avatar
 * (auto-updating), the action is Subscribe-to-author, the byline is dropped (the
 * title already names them), and there's no version history or CLI kit install
 * (a virtual kit has no slug). Public skills only.
 */
export default async function AuthorKitPage({ params }: { params: Promise<Params> }) {
  const { author } = await params
  const [session, result] = await Promise.all([auth(), getAuthorKit(author)])
  if (result.kind !== 'ok') notFound()
  const kit = result.kit

  const viewerHandle = session?.handle ?? null
  const isOwner = viewerHandle === kit.owner
  const initial = (kit.name || kit.owner).slice(0, 2).toUpperCase()
  const skillRefs = kit.skills.map((s) => s.skill_id.replace(':', '/'))
  const categories = kit.skills.map((s) => s.category ?? null)
  // Same cover as the profile's author-kit card: seeds on the member refs.
  const coverSeed = skillRefs.join(',') || `${kit.owner}/${kit.name}`
  const subscriberCount = kit.subscriber_count ?? 0

  // The union of the members' capability manifests, attributed per member skill
  // (same TrustPanel aggregate mode as a named kit). Soft-fails to null.
  const kitCapabilities = await getKitCapabilities(kit.skills).catch(() => null)

  return (
    <KitPageLayout
      kitId={coverSeed}
      name={kit.name}
      owner={kit.owner}
      ownerAvatar={kit.avatar_url}
      ownerIsTeam={kit.is_team}
      description={authorKitTagline(kit.owner)}
      skillCount={kit.skills.length}
      categories={categories}
      heroSeed={coverSeed}
      skills={kit.skills}
      capabilities={kitCapabilities}
      // The author-kit leads with the author's face (auto-updating); a team has
      // no single face, so it falls back to the generative kit cover — the same
      // split the profile author-kit card makes.
      coverNode={
        <KitCoverStack
          seed={coverSeed}
          skillCategories={categories}
          owner={kit.owner}
          bare
          {...(kit.is_team
            ? {}
            : { avatar: { url: kit.avatar_url, initial }, centerAvatar: true })}
        />
      }
      // The title is the author's name, so "Kit by @author" would just repeat it.
      hideByline
      action={
        isOwner ? (
          <Button href={`/${kit.owner}`} variant="secondary">
            View profile
          </Button>
        ) : (
          <SubscribeAuthorButton
            author={kit.owner}
            initialSubscribed={!!kit.subscribed}
            viewerHandle={viewerHandle}
            variant="inline"
          />
        )
      }
      // Virtual kit has no live-count id, so it carries a static proof line.
      usedByBlock={
        <UsedBy
          layout="stacked"
          kind="kit"
          initial={subscriberCount}
          faces={[]}
          proof={subscriberCount > 0 ? `Added by ${subscriberCount.toLocaleString()}` : 'New'}
        />
      }
    />
  )
}
