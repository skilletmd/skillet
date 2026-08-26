// Create + migrate the blog DB in a single process, run as `prebuild` before
// `next build`. The build prerenders across many worker processes; if the DB
// file did not exist they would race to create it. This makes the schema once
// so workers only read. No content is inserted (content lives on the server,
// never in this repo). Idempotent: safe on an already-populated DB.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const dbPath = process.env.BLOG_DB_PATH ?? path.join(webRoot, "content/blog.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
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
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    content       TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts (status, published_at);
`);

// Columns added after the table's first release. CREATE TABLE IF NOT EXISTS is a
// no-op on an existing table, so an already-populated blog.db never grows them.
// Mirrored by addColumn() in src/lib/blog-db.ts.
for (const [name, type] of [["seo_title", "TEXT"], ["subject_json", "TEXT"]]) {
  const cols = db.prepare("SELECT name FROM pragma_table_info('posts')").all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
  }
}

const { n } = db.prepare("SELECT COUNT(*) AS n FROM posts").get();
console.log(`[ensure-blog-db] ${dbPath} ready (${n} posts)`);
