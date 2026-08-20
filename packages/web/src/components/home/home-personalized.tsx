import { getFeed, getFollowSuggestions, getPeopleCatalog } from '@/lib/registry'
import { WhoToFollow } from '@/components/discovery-rail'
import {
  CHART_SIZE,
  Shelf,
  SkillEventGrid,
  avatarMapFromPeople,
  recentSkills,
  safe,
} from '@/components/home/home-shared'
import { feedHref } from '@/lib/urls'

/** Fresh-from-following shelf — session-scoped, streams in Suspense. */
export async function HomeFreshShelf() {
  const [following, people] = await Promise.all([
    getFeed('following', { withSession: true }),
    safe(getPeopleCatalog({ limit: CHART_SIZE }), {
      items: [],
      total: 0,
      limit: CHART_SIZE,
      offset: 0,
    }),
  ])

  const avatarByHandle = avatarMapFromPeople(people.items)
  const fresh = recentSkills(following, 2)
  if (fresh.length === 0) return null

  return (
    <Shelf
      title="Fresh from people you follow"
      blurb="The latest from the authors you trust."
      seeAllHref={feedHref()}
    >
      <SkillEventGrid skills={fresh} avatarByHandle={avatarByHandle} />
    </Shelf>
  )
}

/** Who-to-follow rail module — session-scoped, streams in Suspense. */
export async function HomeWhoToFollow() {
  const suggestions = await safe(getFollowSuggestions({ withSession: true }), [])
  return <WhoToFollow suggestions={suggestions} />
}
