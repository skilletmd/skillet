// Slug → display title. Skill slugs are the canonical identity
// ([a-z0-9-], enforced at publish); this is the single place that turns
// them into something readable for headings, cards, and page titles.

const ACRONYMS = new Set([
  'PR',
  'PRD',
  'SQL',
  'API',
  'UI',
  'UX',
  'CI',
  'CD',
  'AI',
  'LLM',
  'CSS',
  'HTML',
  'JS',
  'TS',
  'SEO',
  'QA',
  'ML',
  'CLI',
  'SDK',
  'HTTP',
  'URL',
  'ID',
  'PDF',
  'CSV',
  'AWS',
  'GCP',
  'DB',
])
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

/** Turn a slug like `deploy-to-vercel` into a readable title `Deploy to Vercel`. */
export function humanizeSlug(slug: string): string {
  const words = slug.split(/[-_/]+/).filter(Boolean)
  return words
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (MIXED[lower]) return MIXED[lower]
      if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase()
      if (i > 0 && i < words.length - 1 && MINOR_WORDS.has(lower)) return lower
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
