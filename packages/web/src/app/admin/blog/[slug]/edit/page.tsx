import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { AdminBlogEditor } from '../../admin-blog-editor'
import type { MarkdownEditorFrontmatter } from '@/components/markdown-editor'
import { getPost } from '@/lib/blog'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug, { includeDrafts: true })

  return {
    title: post ? `Edit ${post.title} - Skillet` : 'Edit Blog Post - Skillet',
  }
}

async function EditBlogPostContent({ params }: { params: Promise<{ slug: string }> }) {
  await markDynamicRoute()
  const { slug } = await params
  const post = getPost(slug, { includeDrafts: true })
  if (!post) notFound()

  const frontmatter: MarkdownEditorFrontmatter = {
    title: post.title,
    description: post.description,
    publishedAt: post.publishedAt,
    status: post.status,
    tags: post.tags,
  }

  return (
    <AdminBlogEditor
      initialSlug={slug}
      initialContent={post.content}
      initialFrontmatter={frontmatter}
    />
  )
}

export default function EditBlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <EditBlogPostContent params={params} />
    </Suspense>
  )
}
