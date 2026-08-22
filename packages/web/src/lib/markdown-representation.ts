import 'server-only'

/**
 * The Markdown representation of a page, for `Accept: text/markdown`.
 *
 * Same URL, same information, none of the chrome — the agent gets the prose it
 * came for instead of a 200 KB DOM whose readable text is 2% of the bytes.
 *
 * Where the Markdown comes from, per surface:
 *   - docs and blog: the source Markdown, served verbatim. No HTML round-trip,
 *     so nothing can be lost in conversion.
 *   - skills: the published `SKILL.md`, which IS the artifact an agent runs.
 *   - profiles: composed from the same registry record the page renders.
 *   - the homepage: a hand-written orientation page, because the marketing
 *     layout has no prose worth converting.
 */

import { getDoc } from './docs'
import { getAllPosts, getPost } from './blog'
import { getAuthorProfile, getSkill, getSkillCatalog } from './registry'
import { getSkillBundleSummary } from './skill-bundle-content'
import { classifyRoute } from './agent-routes'
import { siteUrl } from './site-url'

/** A rendered Markdown representation, or `null` when the resource is gone. */
export interface MarkdownRepresentation {
  body: string
  /** Seconds a shared cache may hold this variant. */
  maxAge: number
}

const abs = (path: string): string => new URL(path, siteUrl()).toString()

/** The trailer every representation ends with, so an agent that landed on one
 *  page can find the rest of the site without guessing URLs. */
function footer(): string {
  return [
    '',
    '---',
    '',
    `Skillet, a registry for agent skills. Site map: ${abs('/llms.txt')}`,
    `API: ${abs('/openapi.json')} · Docs: ${abs('/docs')}`,
    '',
  ].join('\n')
}

function homeMarkdown(): string {
  return [
    '# Skillet',
    '',
    'Skillet is a registry for agent skills. A skill is a `SKILL.md` file: instructions,',
    'plus optional scripts, references, and assets, that an AI agent loads to gain a',
    'capability. Publish a skill once and it syncs to every agent runtime you use:',
    'Claude Code, Codex CLI, Cursor, Claude Desktop, ChatGPT, and the rest.',
    '',
    '## What you can do here',
    '',
    '- **Browse and search** the public catalog of skills, kits, and authors.',
    '- **Summon a kit**. Run everything a person publishes, by handle.',
    '- **Publish** your own skills and keep every machine you use current.',
    '- **Approve updates** before they reach your agents. Consent is explicit and per-version.',
    '',
    '## Start here',
    '',
    `- Install the CLI: \`npx skilletmd\`. See ${abs('/docs/install')}`,
    `- Browse the catalog: ${abs('/browse')}`,
    `- Read the API: ${abs('/docs/api')}`,
    `- Machine-readable API description: ${abs('/openapi.json')}`,
    `- Agent orientation file: ${abs('/llms.txt')}`,
    footer(),
  ].join('\n')
}

function docsMarkdown(slug: string[]): string | null {
  const doc = getDoc(slug)
  if (!doc) return null
  const heading = doc.title ? `# ${doc.title}\n` : ''
  const intro = doc.description ? `\n> ${doc.description}\n` : ''
  return `${heading}${intro}\n${doc.content.trim()}\n${footer()}`
}

function blogIndexMarkdown(): string {
  const posts = getAllPosts()
  const lines = posts.map((post) => {
    const date = post.publishedAt ? ` (${post.publishedAt.slice(0, 10)})` : ''
    return `- [${post.title}](${abs(`/blog/${post.slug}`)})${date}: ${post.description}`
  })
  return ['# Skillet blog', '', ...(lines.length ? lines : ['_No posts yet._']), footer()].join(
    '\n',
  )
}

function blogPostMarkdown(slug: string): string | null {
  const post = getPost(slug)
  if (!post) return null
  const meta = [
    post.author ? `By ${post.author}` : null,
    post.publishedAt ? post.publishedAt.slice(0, 10) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return joinLines([
    `# ${post.title}`,
    '',
    post.description ? `> ${post.description}` : null,
    post.description ? '' : null,
    meta || null,
    '',
    post.content.trim(),
    footer(),
  ])
}

/** Join lines, dropping only the `null` entries. Blank strings are deliberate
 *  Markdown separators: a list that abuts a blockquote is swallowed by it. */
function joinLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => line !== null).join('\n')
}

async function profileMarkdown(handle: string): Promise<string | null> {
  const profile = await getAuthorProfile(handle)
  if (!profile) return null
  const publicSkills = profile.skills.filter((s) => s.visibility !== 'private')
  const lines = publicSkills.map(
    (s) => `- [${s.title || s.slug}](${abs(`/${s.author}/${s.slug}`)}): ${s.description}`,
  )
  return joinLines([
    `# ${profile.displayName} (@${profile.username})`,
    '',
    profile.bio ? `> ${profile.bio}` : null,
    profile.bio ? '' : null,
    `- Profile: ${abs(`/${profile.username}`)}`,
    `- Kit (everything they publish): ${abs(`/${profile.username}/kit`)}`,
    `- Public skills: ${publicSkills.length}`,
    profile.followers != null ? `- Followers: ${profile.followers}` : null,
    '',
    '## Skills',
    '',
    ...(lines.length ? lines : ['_No public skills yet._']),
    footer(),
  ])
}

async function skillMarkdown(author: string, slug: string): Promise<string | null> {
  const skill = await getSkill(author, slug, { skipScan: true })
  if (!skill) return null
  // The published SKILL.md is the artifact itself — serve it rather than a
  // description of it. If the bundle is unreachable, fall back to the catalog
  // record so the URL still answers with something useful.
  const bundle = await getSkillBundleSummary(author, slug).catch(() => null)
  const header = joinLines([
    `# ${skill.title || slug} (@${author})`,
    '',
    skill.description ? `> ${skill.description}` : null,
    skill.description ? '' : null,
    `- Page: ${abs(`/${author}/${slug}`)}`,
    `- Install: \`npx skilletmd add ${author}/${slug}\``,
    skill.category ? `- Category: ${skill.category}` : null,
    `- Latest version: ${skill.latestVersion}`,
    '',
  ])

  if (!bundle?.skillMdBody) return `${header}\n${footer()}`
  return [header, '## SKILL.md', '', bundle.skillMdBody.trim(), footer()].join('\n')
}

/** The Markdown catalog index served at `/browse`. */
async function browseMarkdown(): Promise<string> {
  const catalog = await getSkillCatalog({ limit: 100 }).catch(() => ({
    skills: [],
    total: 0,
    limit: 0,
    offset: 0,
  }))
  const lines = catalog.skills
    .filter((s) => s.visibility !== 'private')
    .map((s) => `- [${s.author}/${s.slug}](${abs(`/${s.author}/${s.slug}`)}): ${s.description}`)
  return [
    '# Browse skills',
    '',
    `> The ${catalog.total} most recently published public skills on Skillet. Use the API for the full catalog: ${abs('/openapi.json')}`,
    '',
    ...(lines.length ? lines : ['_The catalog is temporarily unavailable._']),
    footer(),
  ].join('\n')
}

/**
 * Render the Markdown representation of `pathname`, or `null` when nothing is
 * there. `null` is a real 404 in Markdown, not a fall-through to HTML: by the
 * time this runs, `hasMarkdownVariant` has already said the shape is one we
 * serve.
 */
export async function renderMarkdown(pathname: string): Promise<MarkdownRepresentation | null> {
  if (pathname === '/') return { body: homeMarkdown(), maxAge: 3600 }
  if (pathname === '/browse') return { body: await browseMarkdown(), maxAge: 300 }
  if (pathname === '/blog') return { body: blogIndexMarkdown(), maxAge: 600 }

  const segments = pathname.slice(1).split('/').filter(Boolean)

  if (segments[0] === 'docs') {
    const body = docsMarkdown(segments.slice(1))
    return body ? { body, maxAge: 3600 } : null
  }

  if (segments[0] === 'blog' && segments.length === 2) {
    const body = blogPostMarkdown(segments[1]!)
    return body ? { body, maxAge: 600 } : null
  }

  const verdict = classifyRoute(pathname)
  if (verdict.kind === 'registry') {
    if (verdict.check.type === 'author') {
      const body = await profileMarkdown(verdict.check.author)
      return body ? { body, maxAge: 300 } : null
    }
    if (verdict.check.type === 'skill') {
      const body = await skillMarkdown(verdict.check.author, verdict.check.slug)
      return body ? { body, maxAge: 300 } : null
    }
  }
  return null
}
