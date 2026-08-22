import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDoc, getDocSlugs } from '@/lib/docs'
import { OG, ogMeta } from '@/lib/og'
import { DocArticle } from '@/components/doc-article'
import { docStructuredData } from '@/lib/docs-structured-data'

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
  const href = `/docs/${slug.join('/')}`
  return {
    // `searchTitle` when the page declares one — see DocFrontmatter. The
    // suffix is dropped when the override already names the product, so a
    // title never reads "Skillet API reference · Skillet".
    title: doc.searchTitle ?? `${doc.title} · Skillet`,
    description: doc.description,
    // Every docs page has a Markdown twin at its own URL. Advertise it rather
    // than leaving an agent to guess the convention.
    alternates: { canonical: href, types: { 'text/markdown': href } },
    // Per-article share card: the article title under a DOCS eyebrow.
    ...ogMeta(OG.docs({ title: doc.title })),
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const doc = getDoc(slug)
  if (!doc) notFound()
  // A typed record of the artifact this page documents, where one exists. Emits
  // nothing for a page that describes a concept — see lib/docs-structured-data.
  const jsonLd = docStructuredData(slug)
  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
      <DocArticle doc={doc} />
    </>
  )
}
