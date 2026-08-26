import { getPost, STORY_TAG } from '@/lib/blog'
import { renderOgImage } from '@/app/api/og/render'
import { OG } from '@/lib/og'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Rendered on demand and CDN-cached, matching the story route: story content
// lives in the server's blog DB, so a build-time render would see an empty store.
// This is the whole point of the permalink — a story nobody can preview is a
// story nobody forwards.
export default async function StoryOGImage({ params }: { params: Promise<{ story: string }> }) {
  const { story } = await params
  const post = getPost(story)
  const isStory = post ? post.tags.includes(STORY_TAG) : false
  return renderOgImage(
    OG.blog({
      title: isStory && post ? post.title : 'Skillet Daily',
      subtitle: isStory && post ? post.description : 'Agent skills, every weekday.',
    }),
  )
}
