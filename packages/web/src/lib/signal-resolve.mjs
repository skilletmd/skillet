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

/**
 * An install line naming a repo without linking it: `npx skills add owner/name`.
 *
 * Every one of these IS a GitHub repo reference, so it is rewritten into the
 * link form and matched by the same pattern rather than tracked as a second
 * kind of thing. The most common shape for a skill announcement, and it used to
 * carry no repo at all: the card said "not in the registry" and offered no way
 * to get the skill, directly under a line the author wrote to be copied.
 *
 * The tool name is required and comes from a closed list. `add owner/name` on
 * its own is far too common a shape — `git add src/foo`, `npm add scope/pkg` —
 * and a false repo is worse than a missing one, because it sends a reader to
 * someone else's project.
 */
const INSTALL_REPO_RE =
  /\b(?:skills?|skilletmd|skillet)\s+add\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi

/** Install lines rewritten as GitHub URLs, so one pattern finds every repo. */
export function expandInstallLines(text) {
  return String(text ?? '').replace(INSTALL_REPO_RE, (_m, repo) => ` github.com/${repo} `)
}
/**
 * A slash-command skill name, or a `*-skill` name.
 *
 * The leading `(?<=^|\s)` is load-bearing: without it every slash inside prose
 * reads as a command. `Tone: [casual/formal]` published a skill called `formal`,
 * and `npx skills add owner/repo` published one called `repo`. A real invocation
 * starts a token; a repo path is matched by findRepo instead.
 */
export const NAME_RE = /(?<=^|\s)\/([a-z][a-z0-9-]{3,34})\b|\b([a-z][a-z0-9-]{3,30}-skill)\b/gi

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

/**
 * Every GitHub repo a post references, in order of first appearance.
 *
 * Roundup posts are common and long: one "skills you should install" thread
 * named 42 repos. Taking only the first attached an arbitrary one and threw the
 * rest away, which is both a miss and misleading about what the post is.
 */
export function findRepos(text, urls = []) {
  const blob = [expandInstallLines(text), ...urls.filter(Boolean)].join(' ')
  const seen = new Set()
  const out = []
  for (const match of blob.matchAll(REPO_RE)) {
    const repo = normalizeRepo(match[1])
    if (!repo) continue
    const key = repo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(repo)
  }
  return out
}

/** First repo referenced, or null. Convenience over {@link findRepos}. */
export function findRepo(text, urls = []) {
  return findRepos(text, urls)[0] ?? null
}

/** A skill name the post states outright, or null. */
export function namedSkill(text) {
  const bare = stripUrls(text).toLowerCase()
  for (const match of stripUrls(text).matchAll(NAME_RE)) {
    const candidate = (match[1] ?? match[2] ?? '').toLowerCase()
    if (!candidate || candidate.length <= 3 || GENERIC.has(candidate)) continue
    if (candidate.includes('-') || new RegExp(`(^|\\s)/${candidate}\\b`).test(bare)) return candidate
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
  const repos = findRepos(text, urls)
  const repo = repos[0] ?? null
  const named = namedSkill(text)
  const ref = (s) => ({ author: s.author, slug: s.slug })

  const asCollection = (r, skills) => ({
    author: skills[0].author,
    count: skills.length,
    repo: r,
    repoOwner: r.split('/')[0],
  })

  const carried = repos
    .map((r) => ({ repo: r, skills: index.byRepo.get(r.toLowerCase()) ?? [] }))
    .filter((entry) => entry.skills.length > 0)

  // A post that names one skill in a repo we carry is the strongest signal
  // available; take it before any roundup handling.
  for (const entry of carried) {
    const exact = named ? entry.skills.filter((s) => String(s.slug).toLowerCase() === named) : []
    if (exact.length) {
      return {
        match: 'named',
        skills: exact.slice(0, 2).map(ref),
        collection: null,
        collections: [],
        repo: entry.repo,
        repos,
        unknownSkill: null,
      }
    }
  }

  if (carried.length) {
    const collections = carried.map((entry) => asCollection(entry.repo, entry.skills))
    return {
      // A post referencing several carried repos is a roundup, not a pointer at
      // one library, and the card says so instead of picking a winner.
      match: collections.length > 1 ? 'roundup' : 'collection',
      skills: [],
      collection: collections[0],
      collections,
      repo: carried[0].repo,
      repos,
      unknownSkill: null,
    }
  }

  if (named) {
    const bySlug = index.bySlug.get(named)
    if (bySlug?.length) {
      return {
        match: 'named',
        skills: bySlug.slice(0, 2).map(ref),
        collection: null,
        collections: [],
        repo,
        repos,
        unknownSkill: null,
      }
    }
  }

  return { match: 'none', skills: [], collection: null, collections: [], repo, repos, unknownSkill: named }
}
