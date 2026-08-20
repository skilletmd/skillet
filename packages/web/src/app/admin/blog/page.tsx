import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getAllPostsAdmin } from '@/lib/blog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { SettingsList } from '@/components/ui/settings-list'
import { togglePostStatus } from './actions'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export const metadata: Metadata = {
  title: 'Blog Admin - Skillet',
  robots: { index: false, follow: false },
}

async function AdminBlogContent() {
  await markDynamicRoute()
  const posts = getAllPostsAdmin()
  const drafts = posts.filter((post) => post.status === 'draft').length

  return (
    <div>
      <PageHeader
        title="Blog"
        lede={`${posts.length} post${posts.length !== 1 ? 's' : ''} · ${drafts} draft${drafts !== 1 ? 's' : ''}`}
        action={
          <div className="flex items-center gap-2">
            <Button href="/blog" variant="secondary">
              View blog
            </Button>
            <Button href="/admin/blog/new" variant="secondary">
              New post
            </Button>
          </div>
        }
      />

      <SettingsList>
        {posts.map((post) => (
          <li key={post.slug} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/blog/${post.slug}/edit`}
                  className="truncate text-sm font-medium text-(--ink) hover:underline"
                >
                  {post.title || post.slug}
                </Link>
                <Badge variant={post.status === 'published' ? 'success' : 'warning'}>
                  {post.status}
                </Badge>
              </div>
              {post.description && (
                <p className="mt-0.5 truncate text-xs text-(--ink-2)">{post.description}</p>
              )}
              <p className="mt-0.5 text-xs text-(--ink-3)">
                {post.publishedAt ?? 'Unscheduled'}
                {post.status === 'draft' && post.publishedAt ? ' · scheduled' : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              <Link
                href={`/blog/${post.slug}`}
                target="_blank"
                rel="noopener"
                className="text-(--ink-2) underline-offset-2 hover:text-(--ink) hover:underline"
              >
                View
              </Link>
              <form action={togglePostStatus.bind(null, post.slug)}>
                <Button type="submit" variant="tertiary">
                  {post.status === 'published' ? 'Unpublish' : 'Publish'}
                </Button>
              </form>
            </div>
          </li>
        ))}
      </SettingsList>
    </div>
  )
}

export default function AdminBlogPage() {
  return (
    <Suspense fallback={null}>
      <AdminBlogContent />
    </Suspense>
  )
}
