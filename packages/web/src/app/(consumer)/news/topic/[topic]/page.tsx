/**
 * `/news/topic/<category>` redirects to `/browse/<category>`.
 *
 * This route used to be a second category page. It led with topic-filtered
 * news — empty for most topics most weeks — and followed with a strip of bare
 * `@author/slug` chips, so it read as useless. Filling the shelf with real
 * cards fixed the symptom and exposed the actual problem: `/browse/<category>`
 * already renders that exact shelf, in that exact order, and adds category
 * navigation, All/Skills/Kits/People tabs, a sort control and the people
 * publishing there. Two pages answering "what marketing skills are there" is
 * one page and a maintenance cost.
 *
 * A redirect rather than a delete: the path has been linked and indexed, and
 * sending those readers to the better page costs nothing. Topic-scoped news
 * belongs on the browse category page as a band, not on a page of its own.
 */
import { redirect, permanentRedirect } from 'next/navigation'
import { isCategoryKey } from '@/lib/categories'

export default async function NewsTopicRedirect({
  params,
}: {
  params: Promise<{ topic: string }>
}) {
  const { topic } = await params
  // An unknown key was typed or guessed; send it to the topic index rather than
  // a category page that does not exist.
  if (!isCategoryKey(topic)) redirect('/browse')
  permanentRedirect(`/browse/${topic}`)
}
