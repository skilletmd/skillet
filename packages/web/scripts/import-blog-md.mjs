// One-time import of markdown posts into the blog DB.
//
// Use this to load existing/drafted posts (kept privately, outside this repo)
// into the server's blog DB without ever committing the content to this repo.
//
//   node scripts/import-blog-md.mjs <dir-of-md-files>
//   BLOG_DB_PATH=/data/blog.db node scripts/import-blog-md.mjs ~/private/blog
//
// Each *.md / *.mdx file becomes a post (filename = slug). Re-running updates
// existing posts by slug (upsert), so it is safe to run repeatedly.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const dbPath = process.env.BLOG_DB_PATH ?? path.join(webRoot, "content/blog.db");

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: node scripts/import-blog-md.mjs <dir-of-md-files>");
  process.exit(1);
}
const dir = path.resolve(srcDir);
if (!fs.existsSync(dir)) {
  console.error(`directory not found: ${dir}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '', author_bio TEXT, author_avatar TEXT,
    published_at TEXT, updated_at TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
    og_image TEXT, featured INTEGER NOT NULL DEFAULT 0, read_time INTEGER,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const upsert = db.prepare(`
  INSERT INTO posts
    (slug, title, description, author, author_bio, author_avatar,
     published_at, updated_at, tags_json, og_image, featured, read_time, status, content)
  VALUES
    (@slug, @title, @description, @author, @author_bio, @author_avatar,
     @published_at, @updated_at, @tags_json, @og_image, @featured, @read_time, @status, @content)
  ON CONFLICT(slug) DO UPDATE SET
    title=@title, description=@description, author=@author, author_bio=@author_bio,
    author_avatar=@author_avatar, published_at=@published_at, updated_at=@updated_at,
    tags_json=@tags_json, og_image=@og_image, featured=@featured, read_time=@read_time,
    status=@status, content=@content
`);

const files = fs.readdirSync(dir).filter((f) => /\.mdx?$/.test(f));
let imported = 0;
db.exec("BEGIN");
try {
  for (const f of files) {
    const slug = f.replace(/\.(mdx?)$/, "");
    const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf-8"));
    const publishedAt = data.publishedAt ?? data.date ?? data.publish_date ?? null;
    const status = data.status ?? (publishedAt ? "published" : "draft");
    upsert.run({
      slug,
      title: data.title ?? "",
      description: data.description ?? "",
      author: data.author ?? "",
      author_bio: data.authorBio ?? null,
      author_avatar: data.authorAvatar ?? null,
      published_at: publishedAt,
      updated_at: data.updatedAt ?? null,
      tags_json: JSON.stringify(Array.isArray(data.tags) ? data.tags : []),
      og_image: data.ogImage ?? null,
      featured: data.featured ? 1 : 0,
      read_time: data.readTime ?? null,
      status: status === "published" ? "published" : "draft",
      content,
    });
    imported += 1;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`[import-blog-md] imported ${imported} posts from ${dir} -> ${dbPath}`);
