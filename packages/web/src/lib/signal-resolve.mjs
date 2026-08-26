/**
 * Resolve a post about skills to what the registry actually carries.
 *
 * Extracted from the collector so precision is testable without the network.
 * Every attribution bug this surface has had was invisible until someone looked
 * at one specific card, so the rules live here with the fixtures that pin them.
 *
 * Three outcomes, strongest first:
 *   - `named`      — the post names a skill we carry. Link straight to it.
 *   - `collection` — the post points at a repo we mirror but names no single
 *                    skill. Credit the REPO OWNER, never the handle holding our
 *                    copy: a post about someone's plugin is about their work.
 *   - `none`       — no match. Still a feed item, and if it named a skill we do
 *                    not carry, that name is worth surfacing.
 */

export const REPO_RE = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi
export const NAME_RE = /\/([a-z][a-z0-9-]{3,34})\b|\b([a-z][a-z0-9-]{3,30}-skill)\b/gi

/** GitHub paths that look like `owner/repo` but are not repositories. */
const NOT_AN_OWNER = new Set([
  'sponsors',
  'orgs',
  'topics',
  'features',
  'pricing',
  'about',
  'settings',
  'marketplace',
  'collections',
])

/** Words that follow a slash but never name a skill. */
const GENERIC = new Set([
  'skills',
  'skill',
  'claude',
  'agents',
  'agent',
  'codex',
  'cursor',
  'status',
  'search',
  'docs',
  'blog',
  'item',
  'comments',
  'tree',
  'blob',
  'main',
])

/** A URL path matches the slash-command pattern exactly, so strip URLs before
 *  reading skill names out of prose. Without this, `t.co/iywiklizem` reads as a
 *  skill called `iywiklizem`. */
export const stripUrls = (text) => String(text ?? '').replace(/https?:\/\/\S+/g, ' ')

/**
 * Normalise a GitHub path to `owner/repo`.
 *
 * Returns null for non-repository paths. Note the `.git` handling: `rstrip`-style
 * character-set trimming turns `hey-cli` into `hey-cl`, and a truncated repo is a
 * 404 import, so the suffix is removed as a suffix.
 */
export function normalizeRepo(path) {
  if (!path) return null
  let repo = String(path).trim().replace(/\/+$/, '')
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4)
  const [owner, name] = repo.split('/')
  if (!owner || !name) return null
  if (NOT_AN_OWNER.has(owner.toLowerCase())) return null
  return `${owner}/${name}`
}

/** First GitHub repo referenced anywhere in a post, or null. */
export function findRepo(text, urls = []) {
  const blob = [String(text ?? ''), ...urls.filter(Boolean)].join(' ')
  for (const match of blob.matchAll(REPO_RE)) {
    const repo = normalizeRepo(match[1])
    if (repo) return repo
  }
  return null
}

/** A skill name the post states outright, or null. */
export function namedSkill(text) {
  const bare = stripUrls(text).toLowerCase()
  for (const match of stripUrls(text).matchAll(NAME_RE)) {
    const candidate = (match[1] ?? match[2] ?? '').toLowerCase()
    if (!candidate || candidate.length <= 3 || GENERIC.has(candidate)) continue
    if (candidate.includes('-') || bare.includes(`/${candidate}`)) return candidate
  }
  return null
}

/**
 * Index the corpus by repo and by slug.
 *
 * A slug is only indexed when one author owns it. Two authors publishing
 * `code-review` is common, and picking one arbitrarily is how a post about an
 * unrelated tool ended up crediting two strangers.
 */
export function buildIndex(corpus) {
  const byRepo = new Map()
  const bySlugAll = new Map()
  for (const skill of corpus) {
    const repo = normalizeRepo(skill.source_repo)
    if (repo) {
      const key = repo.toLowerCase()
      byRepo.set(key, [...(byRepo.get(key) ?? []), skill])
    }
    const slug = String(skill.slug ?? '').toLowerCase()
    if (slug.length >= 6) bySlugAll.set(slug, [...(bySlugAll.get(slug) ?? []), skill])
  }
  const bySlug = new Map()
  for (const [slug, skills] of bySlugAll) {
    if (new Set(skills.map((s) => s.author)).size === 1) bySlug.set(slug, skills)
  }
  return { byRepo, bySlug }
}

/**
 * Resolve one post.
 *
 * `repo` is returned whether or not it matched, because an unmatched repo is
 * still one click from `/import` and the card offers that instead of a dead end.
 */
export function resolvePost({ text, urls = [] }, index) {
  const repo = findRepo(text, urls)
  const named = namedSkill(text)
  const ref = (s) => ({ author: s.author, slug: s.slug })

  if (repo) {
    const inRepo = index.byRepo.get(repo.toLowerCase())
    if (inRepo?.length) {
      const exact = named ? inRepo.filter((s) => String(s.slug).toLowerCase() === named) : []
      if (exact.length) {
        return { match: 'named', skills: exact.slice(0, 2).map(ref), collection: null, repo, unknownSkill: null }
      }
      return {
        match: 'collection',
        skills: [],
        collection: {
          author: inRepo[0].author,
          count: inRepo.length,
          repo,
          repoOwner: repo.split('/')[0],
        },
        repo,
        unknownSkill: null,
      }
    }
  }

  if (named) {
    const bySlug = index.bySlug.get(named)
    if (bySlug?.length) {
      return { match: 'named', skills: bySlug.slice(0, 2).map(ref), collection: null, repo, unknownSkill: null }
    }
  }

  return { match: 'none', skills: [], collection: null, repo, unknownSkill: named }
}
