import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AdminBlogEditor } from '../admin-blog-editor'
import type { MarkdownEditorFrontmatter } from '@/components/markdown-editor'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export const metadata: Metadata = {
  title: 'New Blog Post - Skillet',
}

const initialFrontmatter: MarkdownEditorFrontmatter = {
  title: '',
  description: '',
  publishedAt: null,
  status: 'draft',
  tags: [],
}

async function NewBlogPostEditor() {
  await markDynamicRoute()
  return (
    <AdminBlogEditor initialSlug={null} initialContent="" initialFrontmatter={initialFrontmatter} />
  )
}

export default function NewBlogPostPage() {
  return (
    <Suspense fallback={null}>
      <NewBlogPostEditor />
    </Suspense>
  )
}
