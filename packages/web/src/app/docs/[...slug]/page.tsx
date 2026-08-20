import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDoc, getDocSlugs } from '@/lib/docs'
import { OG, ogMeta } from '@/lib/og'
import { DocArticle } from '@/components/doc-article'

export async function generateStaticParams() {
  return getDocSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>
}): Promise<Metadata> {
  const { slug } = await params
  const doc = getDoc(slug)
  if (!doc) return {}
  return {
    title: `${doc.title} · Skillet`,
    description: doc.description,
    // Per-article share card: the article title under a DOCS eyebrow.
    ...ogMeta(OG.docs({ title: doc.title })),
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const doc = getDoc(slug)
  if (!doc) notFound()
  return <DocArticle doc={doc} />
}
