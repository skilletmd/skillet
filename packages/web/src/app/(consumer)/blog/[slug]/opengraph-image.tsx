import { getPost } from '@/lib/blog'
import { renderOgImage } from '@/app/api/og/render'
import { OG } from '@/lib/og'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// No generateStaticParams / force-static: blog content lives on the server's disk,
// so the build runs against an empty blog DB. The OG image renders on-demand
// (CDN-cached) per post, matching the post route.

export default async function BlogPostOGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  return renderOgImage(
    OG.blog({ title: post?.title ?? 'Skillet Blog', subtitle: post?.description ?? undefined }),
  )
}
