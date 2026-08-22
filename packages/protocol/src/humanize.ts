// Slug → display title. The single source of truth, shared by the web app
// (skill/kit headings, cards, page titles) and the registry sync engine (the
// generated name for a mirrored kit and for a unified bundle).
//
// These used to be two implementations. The registry's was a bare
// `\b\w -> uppercase`, so `ibelick/ui-skills` became the kit "Ui Skills" while
// the same repo's skill rendered "UI Skills Root" through the web's
// acronym-aware version. Kit names are STORED at create time, so a divergence
// here is not a render bug that fixes itself — it is baked into the row.
//
// Node-free on purpose: web and the desktop webview import this subpath
// directly (never the package barrel, which pulls node:crypto).

/** Uppercased wholesale. Only entries that are always an initialism. */
const ACRONYMS = new Set([
  'API',
  'AWS',
  'B2B',
  'CD',
  'CI',
  'CLI',
  'CMS',
  'CRM',
  'CSS',
  'CSV',
  'DNS',
  'ERP',
  'GCP',
  'HTML',
  'HTTP',
  'JSON',
  'KPI',
  'LLM',
  'MCP',
  'PDF',
  'PRD',
  'ROI',
  'RSS',
  'SDK',
  'SEO',
  'SQL',
  'SSR',
  'SVG',
  'TDD',
  'URL',
  'XML',
  'YAML',
])

/** Neither lowercase nor Title Case — a specific brand spelling. */
const MIXED: Record<string, string> = {
  k8s: 'K8s',
  oauth: 'OAuth',
  graphql: 'GraphQL',
  github: 'GitHub',
  gitlab: 'GitLab',
  npm: 'npm',
  ios: 'iOS',
  macos: 'macOS',
  postgres: 'Postgres',
  nextjs: 'Next.js',
  nodejs: 'Node.js',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
}

// Function words stay lowercase in title case ("Deploy to Vercel", not
// "Deploy To Vercel") — except as the first or last word.
const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'off',
  'on',
  'or',
  'per',
  'the',
  'to',
  'via',
  'vs',
  'with',
])

/**
 * Two-letter tokens are initialisms far more often than words in this corpus
 * (ui, pm, ux, qa, db, js, ts, ai, ml, ci, cd, pr, hr, vc, os, ip, sf), so the
 * DEFAULT for a two-letter token is uppercase. This set is the exception list:
 * two-letter tokens that are ordinary English words and must stay words.
 *
 * Listing the words rather than the initialisms is what makes the rule hold for
 * initialisms nobody has thought to enumerate yet.
 */
const TWO_LETTER_WORDS = new Set([
  'ah',
  'am',
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'go',
  'he',
  'hi',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'oh',
  'ok',
  'on',
  'or',
  'so',
  'to',
  'up',
  'us',
  'we',
])

/**
 * Turn a slug like `deploy-to-vercel` into a readable title `Deploy to Vercel`.
 *
 * Accepts `-`, `_`, `/` and whitespace as separators, so it works on a slug
 * (`ui-skills-root`) and on a repo name (`pm-skills`) alike.
 */
export function humanizeSlug(slug: string): string {
  const words = slug.split(/[-_/\s]+/).filter(Boolean)
  return words
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (MIXED[lower]) return MIXED[lower]
      if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase()
      const isEdge = i === 0 || i === words.length - 1
      if (!isEdge && MINOR_WORDS.has(lower)) return lower
      if (lower.length === 2 && !TWO_LETTER_WORDS.has(lower)) return lower.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
