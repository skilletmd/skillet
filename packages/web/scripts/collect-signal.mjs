#!/usr/bin/env node
/**
 * Collect external signal for /news.
 *
 * Three sources, because they answer different questions:
 *   - X search nets  — where skills get announced ("I built /animate-expo")
 *   - X timelines    — a watched set, for people whose posts matter regardless
 *   - Hacker News    — where people argue about whether a skill is any good
 *
 * Writes `src/lib/news-signal-seed.json`. That file is the contract the page
 * reads; when this grows a `signal_mentions` table, the page does not change.
 *
 * Env:
 *   TWITTERAPI_IO_KEY   required for the X nets (twitterapi.io)
 *   SIGNAL_DAYS         lookback window, default 7
 *   REGISTRY_URL        registry origin, for resolving posts to skills
 *
 * Usage: node scripts/collect-signal.mjs
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'src', 'lib', 'news-signal-seed.json')
const DAYS = Number(process.env.SIGNAL_DAYS ?? 7)
const REGISTRY = (process.env.REGISTRY_URL ?? 'http://127.0.0.1:3481').replace(/\/+$/, '')
const X_KEY = process.env.TWITTERAPI_IO_KEY

/** Engagement floors per source. Percentile ranking alone over-promotes the thin
 *  tail of a low-volume source, so each network has a bar to clear first. */
const FLOOR = { x: 40, hn: 3, reddit: 10 }
/** Scoreless items (HN comments have no points) qualify on substance instead. */
const MIN_CHARS = 90

const since = () => {
  const d = new Date(Date.now() - DAYS * 86400_000)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- X (search)
const NETS = [
  ['shipped-a-skill', '("built a skill" OR "made a skill" OR "wrote a skill" OR "new skill" OR "open-sourcing") (skill OR SKILL.md OR "claude code" OR codex OR cursor) min_faves:15'],
  ['recommending', '(skill OR skills) ("you should install" OR "my favorite" OR "best skill" OR "game changer" OR underrated) (agent OR "claude code" OR codex OR cursor) min_faves:15'],
  ['collections', '(skills) ("here are" OR "list of" OR collection OR "my setup" OR "i use") (claude OR agent OR codex OR cursor) min_faves:25'],
  ['authoring', '(SKILL.md OR "agent skill" OR "agent skills") (wrote OR published OR shipped OR built) min_faves:15'],
  ['repo-drop', 'github.com (skill OR skills) (claude OR agent OR codex OR cursor) min_faves:20'],
]

async function xSearch(query, cursor) {
  const params = { queryType: 'Top', query }
  if (cursor) params.cursor = cursor
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { 'X-API-Key': X_KEY, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`twitterapi ${res.status}`)
  const body = await res.json()
  return { tweets: body.tweets ?? [], cursor: body.next_cursor ?? null }
}

/** Two pages per net. One page caps at 20 and the second is where the
 *  mid-engagement long tail lives, which is most of the useful material. */
async function xSearchPaged(query, pages = 2) {
  const all = []
  let cursor
  for (let i = 0; i < pages; i++) {
    const { tweets, cursor: next } = await xSearch(query, cursor)
    all.push(...tweets)
    if (!next) break
    cursor = next
  }
  return all
}

async function collectX() {
  if (!X_KEY) {
    console.warn('  ! TWITTERAPI_IO_KEY unset, skipping X')
    return []
  }
  const out = []
  for (const [net, q] of NETS) {
    try {
      const tweets = await xSearchPaged(`${q} since:${since()}`)
      console.log(`  x  ${net.padEnd(18)} ${tweets.length}`)
      for (const t of tweets) {
        out.push({
          source: 'x',
          id: t.id,
          handle: t.author?.userName,
          name: t.author?.name,
          followers: t.author?.followers ?? null,
          text: t.text ?? '',
          url: t.url ?? `https://x.com/i/status/${t.id}`,
          likes: t.likeCount ?? null,
          views: t.viewCount ?? null,
          createdAt: t.createdAt ?? null,
          urls: (t.entities?.urls ?? []).map((u) => u.expanded_url).filter(Boolean),
          context: null,
          net,
        })
      }
    } catch (cause) {
      console.warn(`  ! x ${net}: ${cause.message}`)
    }
  }
  return out
}

// ------------------------------------------------------------- Hacker News
const HN_QUERIES = ['"claude skill"', '"agent skill"', '"skill.md"', '"agent skills"', '"claude code" skill']

async function collectHN() {
  const sinceTs = Math.floor((Date.now() - DAYS * 86400_000) / 1000)
  const out = []
  for (const query of HN_QUERIES) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?${new URLSearchParams({
      query, tags: '(story,comment)', numericFilters: `created_at_i>${sinceTs}`, hitsPerPage: '50',
    })}`
    try {
      const res = await fetch(url)
      const hits = (await res.json()).hits ?? []
      console.log(`  hn ${query.padEnd(18)} ${hits.length}`)
      for (const h of hits) {
        const text = h.title ?? h.comment_text ?? h.story_text ?? ''
        if (!text) continue
        out.push({
          source: 'hn',
          id: h.objectID,
          handle: h.author,
          name: h.author,
          followers: null,
          text,
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          likes: h.points ?? null,
          views: null,
          createdAt: h.created_at ?? null,
          urls: h.url ? [h.url] : [],
          context: h.story_title ?? null,
          net: 'hn',
        })
      }
    } catch (cause) {
      console.warn(`  ! hn ${query}: ${cause.message}`)
    }
  }
  return out
}

// --------------------------------------------------------------- resolution
/**
 * The public `/skills` list API does not return `source_repo`, and that field is
 * the only precise join between "a post links github.com/owner/repo" and "we
 * carry that repo's skills". Without it only slug matching works, which resolves
 * almost nothing. Two ways to close it, in preference order:
 *   1. add `source_repo` to the list API response, or
 *   2. run this collector inside packages/registry where Prisma is available.
 * Until then this returns the slug corpus and repo matching stays dark.
 */
async function loadCorpus() {
  const skills = []
  for (let offset = 0; offset < 3000; offset += 100) {
    const res = await fetch(`${REGISTRY}/api/v1/skills?limit=100&offset=${offset}`)
    if (!res.ok) break
    const page = (await res.json()).skills ?? []
    skills.push(...page)
    if (page.length < 100) break
  }
  if (skills.length && !('source_repo' in skills[0])) {
    console.warn('  ! list API omits source_repo: repo-to-skill matching disabled')
  }
  return skills
}

const REPO_RE = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi
const NAME_RE = /\/([a-z][a-z0-9-]{3,34})\b|\b([a-z][a-z0-9-]{3,30}-skill)\b/gi
const ABOUT = /\b(skill|skills|SKILL\.md)\b/i
const LINK_ONLY = /^\s*(https?:\/\/\S+\s*)+$/
const NOT_SKILL = /\b(inference|quantiz|fine-?tun|token\/s|drum|sequencer)\b/i
const GENERIC = new Set(['skills', 'skill', 'claude', 'agents', 'agent', 'codex', 'cursor', 'status', 'search', 'docs', 'blog', 'item', 'comments'])

const clean = (t) => (t ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
/** A retweet is not the retweeter's statement, and the name, avatar, follower
 *  count and permalink on the record all belong to whoever reposted it. There is
 *  no faithful way to render one, so they never enter the feed. */
const IS_RETWEET = /^RT @[A-Za-z0-9_]+:/
/** URL paths match the slash-command pattern, so strip them before extraction. */
const stripUrls = (t) => t.replace(/https?:\/\/\S+/g, ' ')

function namedSkill(text) {
  const bare = stripUrls(text).toLowerCase()
  for (const m of stripUrls(text).matchAll(NAME_RE)) {
    const c = (m[1] ?? m[2] ?? '').toLowerCase()
    if (!c || c.length <= 3 || GENERIC.has(c)) continue
    if (c.includes('-') || bare.includes(`/${c}`)) return c
  }
  return null
}

function buildIndex(corpus) {
  const bySlug = new Map()
  for (const s of corpus) {
    const slug = String(s.slug).toLowerCase()
    if (slug.length < 6) continue
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), s])
  }
  return { bySlug }
}

function resolve(text, urls, index) {
  const blob = [text, ...urls].join(' ')
  for (const m of blob.matchAll(REPO_RE)) void m // repo→skill needs source_repo, absent from the public list API
  for (const m of stripUrls(text).matchAll(NAME_RE)) {
    const c = (m[1] ?? m[2] ?? '').toLowerCase()
    const hit = index.bySlug.get(c)
    if (hit && new Set(hit.map((s) => s.author)).size === 1) {
      return { match: 'named', skills: hit.slice(0, 2).map((s) => ({ author: s.author, slug: s.slug })), collection: null }
    }
  }
  return { match: 'none', skills: [], collection: null }
}

// --------------------------------------------------------------------- main
async function main() {
  console.log(`collecting signal since ${since()}`)
  const [xs, hns, corpus] = await Promise.all([collectX(), collectHN(), loadCorpus()])
  console.log(`  corpus ${corpus.length} skills`)
  const index = buildIndex(corpus)

  const seen = new Set()
  let rows = []
  for (const raw of [...xs, ...hns]) {
    const text = clean(raw.text)
    if (!text || IS_RETWEET.test(text)) continue
    if (LINK_ONLY.test(text) || !ABOUT.test(text) || NOT_SKILL.test(text)) continue
    const key = text.slice(0, 90).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const { match, skills, collection } = resolve(text, raw.urls ?? [], index)
    rows.push({
      handle: raw.handle, name: raw.name, followers: raw.followers,
      text, url: raw.url, likes: raw.likes, views: raw.views, createdAt: raw.createdAt,
      source: raw.source, context: raw.context,
      match, skills, collection,
      unknownSkill: match === 'none' ? namedSkill(text) : null,
      topics: [],
    })
  }

  rows = rows.filter((r) =>
    r.likes == null ? r.source !== 'x' && r.text.length >= MIN_CHARS : r.likes >= (FLOOR[r.source] ?? 0),
  )

  // Percentile within each source, so HN points and X likes rank fairly.
  for (const source of new Set(rows.map((r) => r.source))) {
    const group = rows.filter((r) => r.source === source).sort((a, b) => (a.likes ?? 0) - (b.likes ?? 0))
    group.forEach((r, i) => { r.rank = i / Math.max(1, group.length - 1) })
  }
  rows.sort((a, b) => b.rank - a.rank)

  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), items: rows }, null, 1))
  const counts = Object.fromEntries(['x', 'hn', 'reddit'].map((s) => [s, rows.filter((r) => r.source === s).length]))
  console.log(`\nwrote ${rows.length} items`, counts)
  console.log(`  registry-linked ${rows.filter((r) => r.match !== 'none').length}`)
  console.log(`  names uncarried ${rows.filter((r) => r.unknownSkill).length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
