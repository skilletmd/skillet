import type { Metadata } from 'next'
import { getAllPosts } from '@/lib/blog'
import { blogHref } from '@/lib/urls'
import { BlogIndex } from './blog-index'

const TITLE = 'Agent skills blog: writing, syncing, and trust · Skillet'
const DESCRIPTION =
  'Field notes on agent skills: how to write one worth installing, how skills travel between agents, and how to judge who wrote the thing before you run it.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: blogHref(),
    types: { 'application/rss+xml': [{ url: '/blog/rss.xml', title: 'Skillet Blog' }] },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: blogHref(),
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function BlogIndexPage() {
  const posts = getAllPosts()
  return <BlogIndex posts={posts} />
}
