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
import { getEditorialPosts, getPost } from './blog'
import { getAuthorProfile, getSkill, getSkillCatalog } from './registry'
import type { Skill } from './types'
import { fetchSkillBundleFile, getSkillBundleSummary } from './skill-bundle-content'
import { classifyRoute } from './agent-routes'
import { siteUrl } from './site-url'
import { REGISTRY_API } from './registry-prefix'
import { capabilityLabel } from './scan-taxonomy'
import { SKILL_ENTRYPOINT } from './skill-bundle'

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
  const posts = getEditorialPosts()
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
    // Same rule the HTML header follows: a zero argues against the profile it
    // is describing, and at launch every profile has zeros in every slot.
    profile.followers ? `- Followers: ${profile.followers}` : null,
    '',
    '## Skills',
    '',
    ...(lines.length ? lines : ['_No public skills yet._']),
    footer(),
  ])
}

/**
 * Bundle size at or under which the twin inlines every file by default.
 *
 * Picked from the live catalog, not from taste. Across a 400-skill sample the
 * median bundle is 14 KB and p90 is 54 KB, while p99 is 1.2 MB and the largest
 * is 1.8 MB across 200 files — the distribution is not long-tailed, it is
 * bimodal. 50 KB (roughly 12k tokens) covers 88% of skills.
 *
 * Why inline at all: a round trip in an agent loop costs a whole model turn.
 * Making the 88% spend one to save ~12k tokens is a bad trade, and linking
 * everything by default made exactly that trade. The tail is what the threshold
 * is for, and the tail is entirely reference files — the largest SKILL.md in
 * the sample is 87 KB, because keeping the entrypoint small is the format's own
 * discipline.
 */
const AUTO_INLINE_THRESHOLD_BYTES = 50 * 1024

/**
 * Hard ceiling on what `?full=1` will inline, even when explicitly asked.
 *
 * 512 KB is roughly 128k tokens. Above it a caller is not getting a large
 * response, they are getting a context bomb: five skills in the sample exceed
 * this, topping out near 456k tokens. Those stay un-servable in one response,
 * which is the correct answer rather than a truncation nobody notices.
 */
const FULL_INLINE_BUDGET_BYTES = 512 * 1024

/** Byte count as a short human string, for a sentence explaining a decision. */
function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Public URL that returns one file from a published version, verbatim. */
function bundleFileUrl(author: string, slug: string, hash: string, path: string): string {
  const base = `${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(hash)}/file`
  return abs(`${base}?path=${encodeURIComponent(path)}`)
}

/**
 * What the skill is allowed to do, from the static scan.
 *
 * Four states, and they are NOT interchangeable (see `Skill.capabilities`):
 * never fetched, never computed, computed-and-empty, and computed-with-results.
 * Collapsing the first two into "no permissions" would tell an agent a skill is
 * inert when nobody ever checked.
 */
function permissionsSection(skill: Skill): string[] {
  if (skill.capabilities === undefined) return []
  if (skill.capabilities === null) {
    return ['## Permissions', '', 'Not analyzed for this version.', '']
  }
  if (skill.capabilities.length === 0) {
    return [
      '## Permissions',
      '',
      skill.capabilitiesAnalysis === 'partial'
        ? 'None detected, but some files could not be inspected. Not a proof of inertness.'
        : 'None detected. Everything executable was inspected.',
      '',
    ]
  }
  const labels = skill.capabilities.map((c) => capabilityLabel(c.capability))
  return [
    '## Permissions',
    '',
    ...labels.map((label) => `- ${label}`),
    ...(skill.capabilitiesAnalysis === 'partial'
      ? ['', 'Some files could not be inspected, so this list may be incomplete.']
      : []),
    '',
  ]
}

/**
 * The Markdown twin of a skill page.
 *
 * The published SKILL.md is the artifact itself — serve it rather than a
 * description of it. But SKILL.md is an INDEX as often as it is the whole
 * instruction set: the format's progressive-disclosure model has it say "read
 * `references/cli.md`" and load that only when the task needs it. Serving the
 * body alone therefore handed an agent instructions whose pointers went
 * nowhere. The file list below fixes that with a fetchable URL per file, which
 * keeps the disclosure model intact — the caller still chooses what to load.
 *
 * Whether those files are inlined or linked is decided by bundle size, because
 * the catalog is bimodal: 88% of skills fit in 50 KB, and the rest run to 1.8 MB.
 * `?full=1` forces inlining up to a hard cap, `?full=0` forces links. Both modes
 * say which one they are in.
 */
async function skillMarkdown(
  author: string,
  slug: string,
  options: { full?: boolean } = {},
): Promise<string | null> {
  // No `skipScan` here, unlike the rest of this module: the scan is where
  // `capabilities` comes from, and "what is this allowed to do" is the question
  // an agent has to answer before running third-party instructions. One extra
  // fetch, on a response cached for five minutes.
  const skill = await getSkill(author, slug)
  if (!skill) return null
  // If the bundle is unreachable, fall back to the catalog record so the URL
  // still answers with something useful.
  const bundle = await getSkillBundleSummary(author, slug).catch(() => null)

  const source = skill.mirrorSourceUrl
    ? `- Source: ${skill.mirrorSourceUrl}${skill.mirrorLicense ? ` (${skill.mirrorLicense})` : ''}`
    : null

  const header = joinLines([
    `# ${skill.title || slug} (@${author})`,
    '',
    skill.description ? `> ${skill.description}` : null,
    skill.description ? '' : null,
    `- Page: ${abs(`/${author}/${slug}`)}`,
    `- Install: \`npx skilletmd add ${author}/${slug}\``,
    skill.category ? `- Category: ${skill.category}` : null,
    `- Latest version: ${skill.latestVersion}`,
    bundle?.versionHash ? `- Version hash: ${bundle.versionHash}` : null,
    // Context budget is a real constraint for the caller; say it before they
    // spend it rather than after.
    skill.tokenCount ? `- Size: ~${skill.tokenCount} tokens` : null,
    source,
    `- Updated: ${skill.updatedAt.slice(0, 10)}`,
    '',
  ])

  if (!bundle?.skillMdBody) return `${header}\n${footer()}`

  const extras = bundle.files.filter((f) => f.path !== SKILL_ENTRYPOINT)
  const totalBytes = bundle.files.reduce((sum, f) => sum + f.size, 0)
  // Three states, not two: an absent `?full` hands the decision here, where the
  // size of THIS bundle is known. Only an explicit value overrides it.
  const inline = options.full ?? totalBytes <= AUTO_INLINE_THRESHOLD_BYTES

  const sections: string[] = [header, ...permissionsSection(skill)]

  if (extras.length > 0) {
    sections.push(
      '## Files',
      '',
      `- \`${SKILL_ENTRYPOINT}\` (included below)`,
      ...extras.map((f) =>
        f.kind === 'binary'
          ? `- \`${f.path}\` (${f.size} bytes, binary): ${bundleFileUrl(author, slug, bundle.versionHash, f.path)}`
          : `- \`${f.path}\` (${f.size} bytes): ${bundleFileUrl(author, slug, bundle.versionHash, f.path)}`,
      ),
      '',
      // Say what comes back. The file endpoint answers a JSON envelope, not raw
      // bytes, and a link inside a Markdown document reads like it will return
      // Markdown — an agent that assumes so parses a `{"path":…}` object as
      // prose and gets nonsense.
      'Each URL returns JSON; the file body is in the `text` field.',
      '',
      // Always state which mode this response is in. The shape varies by bundle
      // size, so a reader that is not told cannot distinguish "this skill has no
      // more content" from "the rest is behind those links".
      ...(inline
        ? ['Every text file is inlined below, so nothing here needs fetching.']
        : [
            options.full === false
              ? `This bundle is ${humanBytes(totalBytes)}. Files are linked, not inlined, because \`?full=0\` was set.`
              : `This bundle is ${humanBytes(totalBytes)}, over the ${humanBytes(AUTO_INLINE_THRESHOLD_BYTES)} inline threshold, so files are linked instead. Append \`?full=1\` to inline them anyway.`,
          ]),
      '',
    )
  }

  sections.push('## SKILL.md', '', bundle.skillMdBody.trim(), '')

  if (inline && extras.length > 0) {
    sections.push(...(await inlinedFiles(author, slug, bundle.versionHash, extras)))
  }

  return [...sections, footer()].join('\n')
}

/**
 * Bodies for `?full=1`, in bundle order, stopping at the byte budget.
 *
 * A truncated response that does not say it was truncated is worse than a
 * short one: the caller cannot tell "this skill has no more files" from "we
 * stopped sending them". Every omission is named.
 */
async function inlinedFiles(
  author: string,
  slug: string,
  hash: string,
  files: Array<{ path: string; kind: 'text' | 'binary'; size: number }>,
): Promise<string[]> {
  const out: string[] = []
  const skipped: string[] = []
  let spent = 0

  for (const file of files) {
    if (file.kind === 'binary') {
      skipped.push(`\`${file.path}\` (binary)`)
      continue
    }
    if (spent + file.size > FULL_INLINE_BUDGET_BYTES) {
      skipped.push(`\`${file.path}\` (over the inline budget)`)
      continue
    }
    const fetched = await fetchSkillBundleFile(author, slug, hash, file.path).catch(() => null)
    if (!fetched?.text) {
      skipped.push(`\`${file.path}\` (unreadable)`)
      continue
    }
    spent += file.size
    out.push(`## ${file.path}`, '', fetched.text.trim(), '')
  }

  if (skipped.length > 0) {
    out.push(
      '## Not inlined',
      '',
      ...skipped.map((s) => `- ${s}`),
      '',
      'Fetch these at the URLs in the file list above.',
      '',
    )
  }
  return out
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
/** Per-surface knobs a caller can set from the query string. */
export interface MarkdownOptions {
  /**
   * Force-inline every text file in a skill bundle (`true`), force links
   * (`false`), or leave it undefined to let bundle size decide. Undefined is
   * the common case and is NOT the same as `false`.
   */
  full?: boolean
}

export async function renderMarkdown(
  pathname: string,
  options: MarkdownOptions = {},
): Promise<MarkdownRepresentation | null> {
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
      const body = await skillMarkdown(verdict.check.author, verdict.check.slug, {
        full: options.full,
      })
      return body ? { body, maxAge: 300 } : null
    }
  }
  return null
}
