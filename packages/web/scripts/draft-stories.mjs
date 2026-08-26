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
import { storyCandidates, reach, normalizeHandles } from '../src/lib/story-cluster.mjs'
import { SKILL_KIND, NEWS_KIND, STORY_KINDS } from '../src/lib/story-kind.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SEED = path.join(HERE, '..', 'src', 'lib', 'news-signal-seed.json')
const DB = process.env.BLOG_DB_PATH ?? path.join(HERE, '..', 'content', 'blog.db')
const API_KEY = process.env.ANTHROPIC_API_KEY
const DRAFT_ONLY = process.env.STORY_DRAFT_ONLY === '1'
/** Slots per queue. Separate, because skill posts out-like news posts and one
 *  shared pool ranked news off the page entirely: a real day produced fourteen
 *  skills and zero news. */
const MAX_SKILLS = Number(process.env.STORY_MAX_SKILLS ?? 8)
const MAX_NEWS = Number(process.env.STORY_MAX_NEWS ?? 6)
/** A story is one post in the feed, so it is sized like one. Six subjects in a
 *  single body read as a list and got skipped; each subject gets its own card. */
const MAX_BODY = 280


const MODEL = 'claude-opus-5'
const DRY_RUN = process.argv.includes('--dry-run')

// ----------------------------------------------------------------- classify

/**
 * Sort the day's posts into the skills queue and the news queue.
 *
 * One call for the whole day, before anything is ranked or written, because
 * ranking has to know the queue and a per-post call would be 50 requests to
 * answer a yes/no question.
 *
 * This is not a regex job. "This Claude Code skill decompiles Android APKs" and
 * "OpenClaw vs Hermes vs Grok Bot, all three let you set up skills" share
 * almost every surface feature: both say "skill", both name a runtime, neither
 * carries an install line. The first is a skill someone can install, the second
 * is a comparison of three products. Only reading them apart works.
 *
 * A failed classification is not fatal. Everything falls back to news, which
 * costs a day of skill cards sitting in the wrong queue and nothing else.
 */
async function classifyPosts(posts) {
  const listed = posts
    .map((p, i) => `[${i}] @${p.handle}: ${p.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
  const prompt =
    `Sort each post into one of two buckets.\n\n` +
    `  skill - it is about a specific agent skill someone can install or use. ` +
    `Shipping one, installing one, recommending one, reviewing one, or a pack ` +
    `of them.\n` +
    `  news  - anything else in the field. Labs, models, runtimes, agents, ` +
    `papers, funding, arguments, comparisons of products, career talk.\n\n` +
    `A post that merely mentions the word "skill" while comparing runtimes is ` +
    `news. A post about one installable skill is skill, even with no install ` +
    `line.\n\n` +
    `Reply with ONLY a JSON object mapping each index to "skill" or "news": ` +
    `{"0": "skill", "1": "news", ...}. Every index below must appear.\n\n` +
    listed
  const body = await callModel(prompt, 'low')
  const parsed = body && firstJsonObject(body)
  if (!parsed) {
    console.warn('  ! classification failed; treating every post as news')
    return posts.map((p) => ({ ...p, isSkill: false }))
  }
  const out = posts.map((p, i) => ({ ...p, isSkill: parsed[String(i)] === 'skill' }))
  const skills = out.filter((p) => p.isSkill).length
  console.log(`classified ${skills} skill / ${out.length - skills} news`)
  return out
}

// -------------------------------------------------------------------- write

/** Real headlines from the feed, as calibration. Told only to be "specific",
 *  the model returns category labels ("Skill authors ship packs..."), which sit
 *  next to these in one feed and read as the filler between the real stories.
 *  Examples move it further than any adjective in the instruction did. */
const NEWS_HEADLINES = [
  "Shopify's CEO pushed back on Claude Code reading only CLAUDE.md. Anthropic answered the same afternoon.",
  'NVIDIA measured whether security scans predict skill quality. They correlate at p = 0.14.',
  'A 7,316-star skill was called unsafe by a practitioner. Stars were the only public signal it carried.',
]

/** A skill headline answers "would I install this", so it leads with the skill
 *  and what it does. Leading with the person who mentioned it answers "who is
 *  talking", which no reader asked. "@MiaAI_lab pitched a skill called Ponytail
 *  as the one to add to your harness" is the failure this exists to prevent:
 *  every word about the pitch, none about what the thing does. */
const SKILL_HEADLINES = [
  'Ponytail makes an agent delete fifty lines and write one instead of explaining itself',
  '/scandinavian-design restyles any site as Nordic minimalism from a single slash command',
  'transitions.dev reads the motion already in a codebase and proposes replacements for it',
]

function promptFor(posts, isSkill) {
  const rendered = posts
    .map(
      (p, i) =>
        `[${i + 1}] @${p.handle} on ${p.source ?? 'x'}` +
        (p.likes ? ` (${p.likes} likes)` : '') +
        `\n${p.text.slice(0, 900)}`,
    )
    .join('\n\n')

  return (
    `You write Skillet Daily, a trade brief about AI agent skills. Below ` +
    (posts.length === 1
      ? `is one post collected today.\n\n`
      : `are ${posts.length} posts collected today about the same event.\n\n`) +
    `Write one short post about it. This is a card in a feed, not an article.\n\n` +
    (isSkill
      ? `This is a SKILL post: it is about a specific skill a reader could ` +
        `install or use.\n\nHEADLINE:\n` +
        `- Lead with the skill and what it DOES. The reader is deciding whether ` +
        `to install it; answer that and nothing else.\n` +
        `- The person who posted is NOT the subject. "X pitched a skill called ` +
        `Y" spends the whole headline on the pitch and none on the thing. They ` +
        `are credited in the sources underneath; you do not need to name them.\n` +
        `- Concrete capability beats category. "restyles any site as Nordic ` +
        `minimalism" beats "a design skill". Name the behaviour, not the field.\n` +
        `- Under 110 chars. Examples of the bar:\n` +
        SKILL_HEADLINES.map((h) => `    ${h}\n`).join('') +
        `- Body: the detail the headline left out. How it installs, what it ` +
        `costs the reader, what it does not do. Not who posted it.\n` +
        `- Set kind to "${SKILL_KIND}".\n`
      : `This is a NEWS post: a lab, model, runtime, company, paper or argument ` +
        `in the field.\n\nHEADLINE:\n` +
        `- Name the actor and what they did. Specific nouns and real numbers ` +
        `beat abstractions; "skill authors ship packs" is a category, not a ` +
        `headline. Two short sentences with a turn are welcome. Under 110 ` +
        `chars. No colon-prefix labels, no "and also" clause bolted on the ` +
        `end. Examples:\n` +
        NEWS_HEADLINES.map((h) => `    ${h}\n`).join('') +
        `- Set kind to "${NEWS_KIND}".\n`) +
    `\nRules:\n` +
    `- ONE subject. If the material covers several unrelated things, pick the ` +
    `single most newsworthy one and ignore the rest. A body that lists three ` +
    `things is a list, and a reader skips a list.\n` +
    `- Body: AT MOST ${MAX_BODY} CHARACTERS. Two or three short sentences. Say ` +
    `what happened and the one detail that makes it worth knowing, then stop.\n` +
    `- Assert only what these posts support. No outside knowledge, no numbers ` +
    `that do not appear here, no predictions.\n` +
    `- Cover the subject as a trade publication would. We publish Skillet and we ` +
    `cover everyone; never promote Skillet or disparage anything.\n` +
    `- If the posts disagree, say so and give both sides.\n` +
    `- These are real people who will read this. Name them by handle or by what ` +
    `they built. Never by a label that sizes them up ("a tinkerer", "a hobbyist", ` +
    `"some guy"), and never with a compliment either; we report, we do not rate.\n` +
    `- The headline carries the claim; the body must not restate it in other ` +
    `words. Give the body the detail the headline left out.\n` +
    `- No bullet points, no em-dashes, no hype, no throat-clearing.\n` +
    `- A number inside a post is that poster's claim, not a fact we checked. ` +
    `Star counts, benchmarks and model names from a post get attributed ("the ` +
    `roundup lists...") or left out. Never restate one in our own voice.\n` +
    `- If there is no story here worth a reader's attention, return ` +
    `{"skip": true} and nothing else. Skipping is cheap; a dull card is not.\n\n` +
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

/** One Messages call, returning the reply text or null. Effort is a knob per
 *  caller: classification is a sorting task, writing is not. */
async function callModel(prompt, effort) {
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
      output_config: { effort },
      messages: [{ role: 'user', content: prompt }],
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
    console.warn('  ! model declined; skipping')
    return null
  }
  return (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

async function writeStory(posts, isSkill) {
  const text = await callModel(promptFor(posts, isSkill), 'medium')
  if (!text) return null
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
  // Same reason the headline cap is enforced rather than asked for. Truncating
  // instead would publish a body that stops mid-sentence, and a body over the
  // cap almost always means it covered more than one subject, which is the
  // thing the cap exists to prevent. Drop it and keep the day's other cards.
  if (parsed.summary.trim().length > MAX_BODY) {
    console.warn(`  ! body too long (${parsed.summary.trim().length} chars); skipping`)
    return null
  }
  return {
    headline: parsed.headline.trim(),
    summary: parsed.summary.trim(),
    kind: STORY_KINDS.includes(parsed.kind) ? parsed.kind : 'story',
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
  const classified = await classifyPosts(material)
  const clusters = storyCandidates(classified, { skills: MAX_SKILLS, news: MAX_NEWS })
  console.log(`${material.length} unclustered posts → ${clusters.length} candidate stories`)

  if (DRY_RUN) {
    clusters.forEach((posts, i) => {
      const queue = posts.filter((p) => p.isSkill).length * 2 >= posts.length ? 'skill' : 'news'
      console.log(`\n${queue} ${i + 1} — ${posts.length} posts, ${reach(posts)} likes`)
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
    const story = await writeStory(posts, posts.filter((p) => p.isSkill).length * 2 >= posts.length)
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
