#!/usr/bin/env node
/**
 * Write Skillet Daily stories from the day's collected posts.
 *
 * The feed's two item types have different economics. A skill post is one
 * person naming one skill and needs no writing. A story is the editorial layer
 * over many posts — a launch, a lab shipping, an argument the field is having —
 * and hand-writing one every day is the thing that does not scale.
 *
 * The safety property is structural, not editorial: a story may only be written
 * from posts that were actually collected, and **every post in the cluster
 * becomes a cited source on the published story**. A reader can check every
 * claim against the posts it came from. That is the difference between reporting
 * and an unattributed summary, and it holds whether a person or a model wrote
 * the prose.
 *
 * Stories publish live. Publishing is reversible — a story is a post, and the
 * admin list toggles it back to draft in one click — so the recovery path is a
 * toggle rather than a gate in front of every edition. Set STORY_DRAFT_ONLY=1
 * to write drafts instead.
 *
 * Env:
 *   ANTHROPIC_API_KEY   required; without it the script no-ops, matching the
 *                       registry's classifier
 *   STORY_DRAFT_ONLY    write drafts instead of publishing
 *   STORY_MAX           most stories to write per run (default 3)
 *   BLOG_DB_PATH        story store (default content/blog.db)
 *
 * Usage: node scripts/draft-stories.mjs [--dry-run]
 *   --dry-run  print the clusters and exit, writing nothing and calling no API.
 *              Clustering is the half that decides what a story is ABOUT, so it
 *              is worth inspecting on its own before spending tokens.
 */
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cluster, reach, normalizeHandles, MAX_CLUSTER, MIN_CLUSTER } from '../src/lib/story-cluster.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SEED = path.join(HERE, '..', 'src', 'lib', 'news-signal-seed.json')
const DB = process.env.BLOG_DB_PATH ?? path.join(HERE, '..', 'content', 'blog.db')
const API_KEY = process.env.ANTHROPIC_API_KEY
const DRAFT_ONLY = process.env.STORY_DRAFT_ONLY === '1'
const MAX_STORIES = Number(process.env.STORY_MAX ?? 3)


const MODEL = 'claude-opus-5'
const DRY_RUN = process.argv.includes('--dry-run')

// -------------------------------------------------------------------- write

/** Real headlines from the feed, as calibration. Told only to be "specific",
 *  the model returns category labels ("Skill authors ship packs..."), which sit
 *  next to these in one feed and read as the filler between the real stories.
 *  Examples move it further than any adjective in the instruction did. */
const HOUSE_HEADLINES = [
  "Shopify's CEO pushed back on Claude Code reading only CLAUDE.md. Anthropic answered the same afternoon.",
  'NVIDIA measured whether security scans predict skill quality. They correlate at p = 0.14.',
  'A 7,316-star skill was called unsafe by a practitioner. Stars were the only public signal it carried.',
]

function promptFor(posts) {
  const rendered = posts
    .map(
      (p, i) =>
        `[${i + 1}] @${p.handle} on ${p.source ?? 'x'}` +
        (p.likes ? ` (${p.likes} likes)` : '') +
        `\n${p.text.slice(0, 900)}`,
    )
    .join('\n\n')

  return (
    `You write Skillet Daily, a trade brief about AI agent skills. Below are ` +
    `${posts.length} posts collected today that appear to be about the same subject.\n\n` +
    `Write one story about what they collectively show.\n\n` +
    `Rules:\n` +
    `- Assert only what these posts support. No outside knowledge, no numbers ` +
    `that do not appear here, no predictions.\n` +
    `- Cover the subject as a trade publication would. We publish Skillet and we ` +
    `cover everyone; never promote Skillet or disparage anything.\n` +
    `- If the posts disagree, say so and give both sides.\n` +
    `- These are real people who will read this. Name them by handle or by what ` +
    `they built. Never by a label that sizes them up ("a tinkerer", "a hobbyist", ` +
    `"some guy"), and never with a compliment either; we report, we do not rate.\n` +
    `- Headline: name the actor and what they did. Specific nouns and real ` +
    `numbers beat abstractions; "skill authors ship packs" is a category, not ` +
    `a headline. Two short sentences with a turn are welcome. Under 110 chars. ` +
    `No colon-prefix labels, and no "and also" clause bolted on the end. ` +
    `The house style, for calibration:\n` +
    HOUSE_HEADLINES.map((h) => `    ${h}\n`).join('') +
    `- Summary: three to five sentences, each UNDER 30 WORDS. Short sentences ` +
    `are the house style; a 50-word sentence is a paragraph wearing a disguise. ` +
    `No bullet points, no em-dashes, no hype, no throat-clearing.\n` +
    `- A number inside a post is that poster's claim, not a fact we checked. ` +
    `Star counts, benchmarks and model names from a post get attributed ("the ` +
    `roundup lists...") or left out. Never restate one in our own voice.\n` +
    `- kind: one of launch, labs, research, debate, trust.\n` +
    `- If these posts are not actually about one subject, or there is no story ` +
    `worth publishing, return {"skip": true} and nothing else.\n\n` +
    `Reply with ONLY a JSON object: ` +
    `{"headline": "...", "summary": "...", "kind": "..."} or {"skip": true}\n\n` +
    `Posts:\n\n${rendered}`
  )
}

/** First JSON object in the reply. The prompt asks for bare JSON; models
 *  occasionally wrap it in prose or a fence, and that should not lose a story. */
function firstJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function writeStory(posts) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: promptFor(posts) }],
    }),
  })
  if (!res.ok) {
    console.warn(`  ! api ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return null
  }
  const body = await res.json()
  // A policy decline arrives as HTTP 200 with stop_reason "refusal", so the
  // content array must not be read before checking it.
  if (body.stop_reason === 'refusal') {
    console.warn('  ! model declined this cluster; skipping')
    return null
  }
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const parsed = firstJsonObject(text)
  if (!parsed || parsed.skip) return null
  if (typeof parsed.headline !== 'string' || typeof parsed.summary !== 'string') return null
  // The length rule is enforced here, not just asked for: the first real run
  // returned a 130-character headline with three clauses in it. A story we
  // cannot headline is a story whose subject was too broad, so drop it rather
  // than truncate mid-sentence and publish a fragment.
  if (parsed.headline.length > 120) {
    console.warn(`  ! headline too long (${parsed.headline.length} chars); skipping`)
    return null
  }
  return {
    headline: parsed.headline.trim(),
    summary: parsed.summary.trim(),
    kind: ['launch', 'labs', 'research', 'debate', 'trust'].includes(parsed.kind)
      ? parsed.kind
      : 'story',
  }
}

// ------------------------------------------------------------------- persist

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 8)
    .join('-')
    .slice(0, 60) || 'story'

/** Every clustered post becomes a citation. This is the property that makes an
 *  auto-written story checkable, so it is not optional and not truncated. */
const sourcesFrom = (posts) =>
  posts.map((p) => ({
    network: p.source ?? 'x',
    handle: p.handle,
    label: p.name ?? p.handle,
    detail: p.likes ? `${p.likes.toLocaleString('en-US')} likes` : null,
    url: p.url,
    avatarUrl: p.avatarUrl ?? null,
  }))

async function main() {
  if (!API_KEY && !DRY_RUN) {
    console.warn('ANTHROPIC_API_KEY unset; no stories written.')
    return
  }
  const { items = [] } = JSON.parse(await readFile(SEED, 'utf8'))
  // Posts that already resolve to a skill are their own feed item; stories are
  // built from the rest, which is what the unresolved majority is FOR.
  const material = items.filter((i) => i.match === 'none' && i.text.length > 80)
  const clusters = cluster(material).slice(0, MAX_STORIES)
  console.log(`${material.length} unclustered posts → ${clusters.length} candidate stories`)

  if (DRY_RUN) {
    clusters.forEach((posts, i) => {
      console.log(`\ncluster ${i + 1} — ${posts.length} posts, ${reach(posts)} likes`)
      for (const p of posts) {
        console.log(`  @${p.handle.padEnd(18)} ${p.text.replace(/\s+/g, ' ').slice(0, 74)}`)
      }
    })
    return
  }

  const db = new DatabaseSync(DB)
  // busy_timeout is per-connection, not persisted with the file's WAL mode, so
  // it has to be set on every writer or a concurrent write throws SQLITE_BUSY
  // outright instead of waiting. Matches import-blog-md.mjs.
  db.exec('PRAGMA busy_timeout = 5000')
  const today = new Date().toISOString().slice(0, 10)
  const stmt = db.prepare(`
    INSERT INTO posts (slug, title, description, author, published_at, updated_at,
                       tags_json, status, content, featured, sources_json, story_kind)
    VALUES (?, ?, ?, 'Skillet Daily', ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      updated_at=excluded.updated_at, content=excluded.content,
      sources_json=excluded.sources_json, story_kind=excluded.story_kind
  `)

  let written = 0
  for (const posts of clusters) {
    const story = await writeStory(posts)
    if (!story) continue
    const sources = sourcesFrom(posts)
    story.headline = normalizeHandles(story.headline, sources)
    story.summary = normalizeHandles(story.summary, sources)
    const slug = slugify(story.headline)
    stmt.run(
      slug,
      story.headline,
      story.summary,
      today,
      today,
      JSON.stringify(['story']),
      DRAFT_ONLY ? 'draft' : 'published',
      story.summary,
      JSON.stringify(sources),
      story.kind,
    )
    written += 1
    console.log(`  ${DRAFT_ONLY ? 'drafted' : 'published'} ${slug} (${posts.length} sources)`)
  }

  console.log(`\n${written} ${written === 1 ? 'story' : 'stories'} written`)
  db.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
