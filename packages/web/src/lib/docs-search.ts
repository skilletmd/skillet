/**
 * Web-local search over the documentation. The docs live as markdown in
 * `content/docs/*.md` (plus a few bespoke nav-only pages), which the registry
 * search service can't see — so the global search fetches this through a small
 * Next route and merges a "Docs" group into the same result envelope.
 *
 * Matching is a lightweight weighted scorer over title/heading/description/body.
 * The corpus is small (tens of pages), so full-text search needs no index infra.
 */
import { getDoc, getDocSlugs, extractHeadings } from '@/lib/docs'
import { DOC_NAV } from '@/lib/docs-nav'
import type { SearchDocResult } from '@/lib/search-client'

export interface DocRecord {
  docId: string
  title: string
  description: string
  section: string
  href: string
  headings: { text: string; id: string }[]
  body: string
}

// Field weights: a title hit matters most, then headings, then section /
// description metadata, then plain body text — so the most relevant page sorts
// to the top. Section is scored so e.g. "runtimes" finds the Runtimes pages
// (including the bespoke overview whose nav title is just "Overview").
const WEIGHT = { title: 5, heading: 3, section: 2, description: 2, body: 1 } as const

let cachedRecords: DocRecord[] | null = null

/**
 * Build one searchable record per doc: every markdown page (full text), plus a
 * title-only record for any DOC_NAV page that has no markdown file (bespoke TSX
 * pages like Overview and Runtimes) so nothing in the nav is unsearchable.
 * Memoized — markdown is static per deploy.
 */
export function buildDocRecords(): DocRecord[] {
  if (cachedRecords) return cachedRecords

  const records: DocRecord[] = []
  const coveredHrefs = new Set<string>()

  for (const slug of getDocSlugs()) {
    const doc = getDoc(slug)
    if (!doc) continue
    const href = '/docs/' + slug.join('/')
    coveredHrefs.add(href)
    records.push({
      docId: slug.join('/'),
      title: doc.title,
      description: doc.description,
      section: doc.section,
      href,
      headings: extractHeadings(doc.content).map((h) => ({ text: h.text, id: h.id })),
      body: doc.content,
    })
  }

  for (const section of DOC_NAV) {
    for (const item of section.items) {
      if (coveredHrefs.has(item.href)) continue
      coveredHrefs.add(item.href)
      records.push({
        docId: item.href.replace(/^\/docs\/?/, '') || 'overview',
        title: item.title,
        description: '',
        section: section.title,
        href: item.href,
        headings: [],
        body: '',
      })
    }
  }

  cachedRecords = records
  return records
}

/** Strip markdown syntax so a snippet reads as plain prose. */
function stripMarkdown(line: string): string {
  return line
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2') // italic
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[#>*_~]/g, ' ') // stray markers
    .replace(/\s+/g, ' ')
    .trim()
}

/** First prose line containing a query token, cleaned to a short snippet.
 *  Skips headings, code fences, tables, blockquotes, and dividers. */
function makeSnippet(record: DocRecord, tokens: string[]): string | null {
  for (const raw of record.body.split('\n')) {
    const line = raw.trim()
    if (!line || /^[#>|`]/.test(line) || line.startsWith('```') || line.startsWith('---')) continue
    const clean = stripMarkdown(line)
    if (clean && tokens.some((t) => clean.toLowerCase().includes(t))) {
      return clean.length > 140 ? clean.slice(0, 137).trimEnd() + '…' : clean
    }
  }
  return record.description ? stripMarkdown(record.description) : null
}

/**
 * Score `records` against `query` and return the top `limit` as doc results.
 * Pure (no I/O) so it can be unit-tested with synthetic records.
 */
export function scoreDocs(records: DocRecord[], query: string, limit: number): SearchDocResult[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const results: SearchDocResult[] = []
  for (const record of records) {
    const title = record.title.toLowerCase()
    const section = record.section.toLowerCase()
    const description = record.description.toLowerCase()
    const body = record.body.toLowerCase()

    let score = 0
    let bestHeading: { text: string; id: string } | null = null

    for (const token of tokens) {
      if (title.includes(token)) score += WEIGHT.title
      for (const heading of record.headings) {
        if (heading.text.toLowerCase().includes(token)) {
          score += WEIGHT.heading
          if (!bestHeading) bestHeading = heading
        }
      }
      if (section.includes(token)) score += WEIGHT.section
      if (description.includes(token)) score += WEIGHT.description
      if (body.includes(token)) score += WEIGHT.body
    }

    if (score === 0) continue
    results.push({
      type: 'doc',
      doc_id: record.docId,
      title: record.title,
      section: record.section,
      snippet: makeSnippet(record, tokens),
      // Deep-link to the matched heading when there is one, else the page.
      url: bestHeading ? `${record.href}#${bestHeading.id}` : record.href,
      score,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

/** Search the documentation corpus. */
export function searchDocs(query: string, limit = 5): SearchDocResult[] {
  return scoreDocs(buildDocRecords(), query.trim(), limit)
}
