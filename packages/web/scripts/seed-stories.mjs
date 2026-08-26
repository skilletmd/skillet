#!/usr/bin/env node
/**
 * Seed Skillet Daily stories into the blog store.
 *
 * Stories are posts tagged `story`: same drafts, publish gate, editor and feed
 * builder as every other post. This script exists to move the five stories that
 * were authored as a JSON file into the store where they can be edited without
 * a deploy; day-to-day authoring happens in the admin editor.
 *
 * Usage: node scripts/seed-stories.mjs <stories.json>
 */
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DB = process.env.BLOG_DB_PATH ?? path.join(HERE, '..', 'content', 'blog.db')

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/seed-stories.mjs <stories.json>')
  process.exit(1)
}

const { stories = [] } = JSON.parse(await readFile(input, 'utf8'))
const db = new DatabaseSync(DB)

const stmt = db.prepare(`
  INSERT INTO posts (slug, title, description, author, published_at, updated_at,
                     tags_json, status, content, featured, sources_json, story_kind)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, 0, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    title=excluded.title, description=excluded.description,
    published_at=excluded.published_at, updated_at=excluded.updated_at,
    tags_json=excluded.tags_json, content=excluded.content,
    sources_json=excluded.sources_json, story_kind=excluded.story_kind
`)

for (const story of stories) {
  const date = new Date((story.at ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10)
  stmt.run(
    story.id,
    story.headline,
    story.summary,
    'Skillet Daily',
    date,
    date,
    JSON.stringify(['story']),
    // The feed renders headline + summary + sources; `content` is the long form
    // the permalink shows, and starts as the summary.
    story.summary,
    JSON.stringify(story.sources ?? []),
    story.kind ?? 'story',
  )
}

const n = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE tags_json LIKE '%story%'").get()
console.log(`seeded ${stories.length}; store now holds ${n.n} stories`)
db.close()
