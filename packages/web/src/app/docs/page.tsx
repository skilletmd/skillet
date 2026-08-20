import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDoc } from '@/lib/docs'
import { DocArticle } from '@/components/doc-article'

export function generateMetadata(): Metadata {
  const doc = getDoc([])
  if (!doc) return {}
  return {
    title: `${doc.title} · Skillet`,
    description: doc.description,
  }
}

export default function DocsIndexPage() {
  const doc = getDoc([])
  if (!doc) notFound()
  return <DocArticle doc={doc} />
}
