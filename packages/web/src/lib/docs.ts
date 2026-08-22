import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const CONTENT_DIR = path.join(process.cwd(), 'content/docs')

function isSafeDocSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false
  if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) return false
  return !segment.split('/').some((part) => part === '..')
}

/** Resolve a docs markdown path and verify it stays under CONTENT_DIR. */
function resolveDocFilePath(slug: string[]): string | null {
  if (slug.some((segment) => !isSafeDocSegment(segment))) return null
  const rel = slug.length ? slug.join('/') : 'index'
  const filePath = path.join(CONTENT_DIR, rel) + '.md'
  const resolved = path.resolve(filePath)
  const root = path.resolve(CONTENT_DIR)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

export interface DocFrontmatter {
  title: string
  description: string
  order: number
  section: string
  /** Optional header illustration, e.g. "/docs/concepts.png". */
  image?: string
  /**
   * Optional `<title>` override, for pages whose sidebar label is too generic
   * to survive a name-based search.
   *
   * "API", "CLI reference", and "MCP" are the right labels *inside* the docs,
   * where the product name is already established by every other pixel on the
   * page. They are the wrong strings in a search result: an agent asked to find
   * "the Skillet API docs" is matching against a title that never says Skillet
   * except as a trailing suffix. This lets the two jobs disagree without
   * renaming the nav.
   */
  searchTitle?: string
}

export interface Doc extends DocFrontmatter {
  slug: string[]
  content: string
  editPath: string
}

export function getDocSlugs(): string[][] {
  if (!fs.existsSync(CONTENT_DIR)) return []
  const slugs: string[][] = []

  function walk(dir: string, base: string[]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...base, entry.name])
      } else if (entry.name.endsWith('.md')) {
        // The root index.md is served at /docs by its own route, not the catch-all.
        if (base.length === 0 && entry.name === 'index.md') continue
        slugs.push([...base, entry.name.replace(/\.md$/, '')])
      }
    }
  }

  walk(CONTENT_DIR, [])
  return slugs
}

export function getDoc(slug: string[]): Doc | null {
  const filePath = resolveDocFilePath(slug)
  if (!filePath || !fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const fm = data as Partial<DocFrontmatter>
  const rel = slug.length ? slug.join('/') : 'index'
  return {
    title: fm.title ?? '',
    description: fm.description ?? '',
    order: fm.order ?? 0,
    section: fm.section ?? '',
    image: fm.image,
    searchTitle: fm.searchTitle,
    slug,
    content,
    editPath: 'content/docs/' + rel + '.md',
  }
}

export function extractHeadings(
  content: string,
): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{2,4})\s+(.+)$/)
    if (match) {
      const text = match[2].trim()
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-|-$/g, '')
      headings.push({ level: match[1].length, text, id })
    }
  }
  return headings
}
