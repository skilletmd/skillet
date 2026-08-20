import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getPost } from '@/lib/blog'
import { Editor } from './editor'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export const metadata: Metadata = {
  title: 'Edit post · Skillet admin',
  robots: { index: false, follow: false },
}

async function AdminBlogEditContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ saved?: string }>
}) {
  await markDynamicRoute()
  const { slug } = await params
  const { saved } = await searchParams
  const post = getPost(slug, { includeDrafts: true })
  if (!post) notFound()
  return <Editor post={post} saved={saved === '1'} />
}

export default function AdminBlogEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ saved?: string }>
}) {
  return (
    <Suspense fallback={null}>
      <AdminBlogEditContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}
