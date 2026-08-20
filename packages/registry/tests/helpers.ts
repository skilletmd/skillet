// Shared registry test helpers: spin up an in-memory server, mint dev sessions,
// claim handles, publish skill versions, and subscribe authors — so those
// primitives live in one place rather than being copy-pasted per test file.
import assert from 'node:assert/strict';
import type { PrismaDb } from '../src/db/prisma-client.js';
import { buildServer } from '../src/server.js';
import { mintToken } from '../src/auth/tokens.js';

export type Handle = Awaited<ReturnType<typeof buildServer>>;

export interface DevSession {
  user_id: string;
  session_token: string;
}

/** Deterministic 32-byte Ed25519 public key for a claim, seeded by a byte.
 *  Internal to `claim` — not part of the shared helper surface. */
const PK = (seed: number): string => Buffer.alloc(32, seed).toString('base64');

/**
 * MySQL-backed server for U5+. Requires DATABASE_URL; migrates + truncates,
 * enables Prisma auth (session mint + decorator), memory blobs.
 */
export async function freshMysqlServer(): Promise<Handle> {
  const { ensureMysqlMigrated, resetMysqlRegistry, createTestPrismaClient, requireTestDatabaseUrl } =
    await import('./mysql-test-env.js');

  // The server under test resolves DATABASE_URL from the environment; pin it
  // to the isolated *_test database so no code path can reach the dev DB.
  process.env.DATABASE_URL = requireTestDatabaseUrl();
  await ensureMysqlMigrated();
  const seed = createTestPrismaClient();
  await resetMysqlRegistry(seed);
  await seed.$disconnect();

  if (!process.env.BLOB_STORE) process.env.BLOB_STORE = 'memory';

  // Let createBlobStore attach Prisma so MemoryBlobStore writes blobs meta rows
  // (skill_version_files FK). Do not pass a bare MemoryBlobStore() override.
  const h = await buildServer({
    logger: false,
    usePrismaAuth: true,
    auth: { devAuth: true },
  });
  await h.app.ready();
  return h;
}

/**
 * U5: MySQL-first default. Fail closed without DATABASE_URL.
 * Legacy sqlite characterization uses {@link freshSqliteServer} explicitly.
 */
export async function freshServer(): Promise<Handle> {
  return freshMysqlServer();
}

/** Legacy sqlite :memory: boot for characterization tests not yet ported to MySQL. */
export async function freshSqliteServer(): Promise<Handle> {
  const { openLegacySqlite } = await import('./legacy-sqlite-open.js');
  const h = await buildServer({ db: openLegacySqlite(':memory:'), logger: false });
  await h.app.ready();
  return h;
}

export { freshMysqlPrisma } from './mysql-test-env.js';

export async function mint(h: Handle): Promise<DevSession> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/sessions/dev',
    payload: { two_factor: true },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as DevSession;
}

export async function claim(h: Handle, s: DevSession, handle: string, seed: number): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/claim',
    // key_id MUST be hex(raw pub bytes) — /claim now enforces the binding.
    payload: { handle, public_key: PK(seed), key_id: Buffer.alloc(32, seed).toString('hex') },
    headers: { authorization: `Bearer ${s.session_token}` },
  });
  assert.ok(res.statusCode === 201 || res.statusCode === 200, `claim ${handle}: ${res.body}`);
}

/** Prisma client from a MySQL-backed test server (`freshServer` / `freshMysqlServer`). */
function requireHandlePrisma(h: Handle): PrismaDb {
  const prisma = h.app.skilletPrisma;
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

/** Insert a skill (if absent) + a version at an explicit publish time; bump latest_hash.
 *  `label` sets the stored semver columns; omitted → the schema default 1.0.0.
 *  Defaults to Prisma/MySQL via the handle's decorated client (never sqlite). */
export async function addSkillVersion(
  h: Handle,
  author: string,
  slug: string,
  hash: string,
  publishedAt: number,
  label?: { major: number; minor: number; patch: number },
): Promise<void> {
  await addSkillVersionPrisma(requireHandlePrisma(h), author, slug, hash, publishedAt, label);
}

/** Author subscription written directly (bypasses live baselining), created now.
 *  Defaults to Prisma/MySQL via the handle's decorated client (never sqlite). */
export async function subscribeAuthor(h: Handle, userId: string, author: string): Promise<void> {
  await subscribeAuthorPrisma(requireHandlePrisma(h), userId, author);
}

/**
 * Prisma/MySQL counterpart of {@link addSkillVersion}. Ensures the author row
 * exists (MySQL FKs), uses createMany skipDuplicates instead of INSERT OR IGNORE,
 * and sets metadata_json to `{}` for a valid skill_versions row.
 */
export async function addSkillVersionPrisma(
  prisma: PrismaDb,
  author: string,
  slug: string,
  hash: string,
  publishedAt: number,
  label?: { major: number; minor: number; patch: number },
): Promise<void> {
  const skillId = `${author}:${slug}`;
  await prisma.authors.createMany({
    data: [{ id: author, name: author }],
    skipDuplicates: true,
  });
  await prisma.skills.createMany({
    data: [
      {
        id: skillId,
        author_id: author,
        slug,
        latest_hash: hash,
        visibility: 'public',
      },
    ],
    skipDuplicates: true,
  });
  await prisma.skill_versions.create({
    data: {
      hash,
      skill_id: skillId,
      published_by: author,
      published_at: publishedAt,
      metadata_json: '{}',
      major: label?.major ?? 1,
      minor: label?.minor ?? 0,
      patch: label?.patch ?? 0,
    },
  });
  await prisma.skills.update({
    where: { id: skillId },
    data: { latest_hash: hash },
  });
}

/**
 * Prisma/MySQL counterpart of {@link subscribeAuthor}. Caller must ensure the
 * user and author rows already exist (FK-safe).
 */
export async function subscribeAuthorPrisma(
  prisma: PrismaDb,
  userId: string,
  author: string,
): Promise<void> {
  await prisma.authors.createMany({
    data: [{ id: author, name: author }],
    skipDuplicates: true,
  });
  await prisma.kit_subscriptions.create({
    data: {
      id: `sub-${userId}-${author}`,
      user_id: userId,
      kind: 'author',
      author_id: author,
    },
  });
}

export const authOf = (s: DevSession) => ({ authorization: `Bearer ${s.session_token}` });

/**
 * Plant a devices row with `user_id` NULL — the pre-U6 anonymous shape that no
 * API mints anymore and that migration 049's NOT NULL constraint forbids
 * outright. The manifest's 403 fail-closed guard defends against exactly this
 * out-of-band row, so to exercise it the helper first rebuilds `devices` with
 * the constraint relaxed (same columns, NOT NULL dropped, rows and named
 * indexes preserved), mimicking a pre-049 database.
 */
export function insertNullUserDevice(h: Handle): { device_id: string; device_token: string } {
  const ddl = (
    h.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'").get() as { sql: string }
  ).sql;
  if (/user_id\s+TEXT\s+NOT NULL/.test(ddl)) {
    const relaxed = ddl.replace(/user_id(\s+)TEXT\s+NOT NULL/, 'user_id$1TEXT');
    const indexes = h.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'devices' AND sql IS NOT NULL")
      .all() as Array<{ sql: string }>;
    h.db.exec('PRAGMA foreign_keys = OFF');
    h.db.exec('CREATE TEMP TABLE _devices_backup AS SELECT * FROM devices');
    h.db.exec('DROP TABLE devices');
    h.db.exec(relaxed);
    h.db.exec('INSERT INTO devices SELECT * FROM _devices_backup');
    h.db.exec('DROP TABLE _devices_backup');
    for (const { sql } of indexes) h.db.exec(sql);
    h.db.exec('PRAGMA foreign_keys = ON');
  }
  const device_id = `dev-${Math.random().toString(36).slice(2, 10)}`;
  const { secret, hash } = mintToken('device');
  h.db
    .prepare('INSERT INTO devices (id, token_hash, user_id, label) VALUES (?, ?, NULL, ?)')
    .run(device_id, hash, 'orphan-row');
  return { device_id, device_token: secret };
}
