import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

/**
 * Blog store — its own sqlite database, same pattern as the registry
 * (`packages/registry/src/db/index.ts`): a single file, WAL mode, an
 * idempotent migrate.
 *
 * Content lives in the DB on the server's disk, never in this (open-source)
 * repo: no post markdown is committed. Point BLOG_DB_PATH at a persistent
 * path in production (e.g. /data/blog.db, like the registry's /data disk).
 * Posts are authored through /admin/blog; drafts are kept privately and
 * loaded once with `scripts/import-blog-md.mjs`.
 */

const DEFAULT_DB_PATH = process.env.BLOG_DB_PATH ?? path.join(process.cwd(), 'content/blog.db')

let cached: DatabaseSync | null = null

export function getBlogDb(dbPath = DEFAULT_DB_PATH): DatabaseSync {
  if (cached) return cached
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  // `next build` prerenders across worker processes that all open this file.
  // busy_timeout makes a writer wait for the lock instead of throwing
  // SQLITE_BUSY. The schema is created once by the prebuild step
  // (scripts/ensure-blog-db.mjs) so workers only ever read here.
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  cached = db
  return db
}

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      slug          TEXT PRIMARY KEY,
      title         TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      author        TEXT NOT NULL DEFAULT '',
      author_bio    TEXT,
      author_avatar TEXT,
      published_at  TEXT,
      updated_at    TEXT,
      tags_json     TEXT NOT NULL DEFAULT '[]',
      og_image      TEXT,
      featured      INTEGER NOT NULL DEFAULT 0,
      read_time     INTEGER,
      status        TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published')),
      content       TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_posts_status_published
      ON posts (status, published_at);
  `)

  addColumn(db, 'seo_title', 'TEXT')
}

/**
 * Add a column if the table predates it. `CREATE TABLE IF NOT EXISTS` above is a
 * no-op against an existing table, so a database created before a column was
 * introduced never grows it — which is every deployed blog.db. Mirrored in
 * scripts/ensure-blog-db.mjs, which creates the schema at prebuild time.
 */
function addColumn(db: DatabaseSync, name: string, type: string): void {
  const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('posts') as Array<{
    name: string
  }>
  if (cols.some((c) => c.name === name)) return
  db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`)
}
