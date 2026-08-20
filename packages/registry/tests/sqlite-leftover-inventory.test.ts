// Dual-path removal U1–U6: freeze src/ files that still call prepare/query/runTransaction
// after the MySQL cutover. Mentions and type aliases are ignored.
//
// Rules:
// 1. No new leftover files may appear without updating this allowlist.
// 2. Files with sqlite call sites and zero Prisma hints must stay on the
//    unprotected allowlist (or gain a Prisma twin and leave it).
// 3. Typed calls like query<{…}>(…) / queryOne<T>(…) count (generics blind spot fixed).
//
// After U6, only fail-closed CLI / backfill entrypoints remain on the allowlist.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '../src')

// Optional TypeScript generics between the callee name and '('.
const SQLITE_CALL_RE =
  /\b(?:queryOne|query|runTransaction)(?:\s*<[^>]*>)?\s*\(|\.prepare\s*\(/
const PRISMA_HINT_RE = /\b(prisma|Prisma|livePrisma|usePrismaAuth)\b/

/** Files that may still contain characterization / dual-path sqlite SQL. */
const LEFTOVER_ALLOWLIST = new Set([
  // Fail-closed CLI / backfill entrypoints (R5).
  'avatars/backfill-data-uri-avatars.ts',
  'blob-store/backfill-to-r2.ts',
  'invocation-backfill.ts',
  'scanner/capabilities/backfill.ts',
  'scanner/prod-snapshot.ts',
])

/**
 * Leftover files with sqlite call sites and no Prisma hint in-file.
 * Shrink this as Prisma twins land or files move under tests/.
 */
const UNPROTECTED_ALLOWLIST = new Set([
  'avatars/backfill-data-uri-avatars.ts',
  'blob-store/backfill-to-r2.ts',
  'invocation-backfill.ts',
  'scanner/prod-snapshot.ts',
])

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

function fileHasSqliteCall(text: string): boolean {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//')) continue
    if (SQLITE_CALL_RE.test(line)) return true
  }
  return false
}

function leftoverPaths(): string[] {
  const hits: string[] = []
  for (const file of listTsFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8')
    if (fileHasSqliteCall(text)) {
      hits.push(relative(srcRoot, file).split('\\').join('/'))
    }
  }
  return hits.sort()
}

function unprotectedPaths(leftovers: string[]): string[] {
  const hits: string[] = []
  for (const rel of leftovers) {
    const text = readFileSync(join(srcRoot, rel), 'utf8')
    if (!PRISMA_HINT_RE.test(text)) hits.push(rel)
  }
  return hits.sort()
}

describe('sqlite leftover inventory (dual-path removal U1)', () => {
  it('leftover prepare/query files match the frozen allowlist', () => {
    const hits = leftoverPaths()
    const unexpected = hits.filter((p) => !LEFTOVER_ALLOWLIST.has(p))
    const missing = [...LEFTOVER_ALLOWLIST].filter((p) => !hits.includes(p)).sort()
    assert.deepEqual(
      unexpected,
      [],
      `new leftover files (add a Prisma twin or extend the allowlist):\n${unexpected.join('\n')}`,
    )
    assert.deepEqual(
      missing,
      [],
      `allowlist entry cleared its prepare/query sites (remove from LEFTOVER_ALLOWLIST):\n${missing.join('\n')}`,
    )
  })

  it('unprotected leftovers (no Prisma hint) match the shrinking allowlist', () => {
    const unprotected = unprotectedPaths(leftoverPaths())
    const unexpected = unprotected.filter((p) => !UNPROTECTED_ALLOWLIST.has(p))
    const missing = [...UNPROTECTED_ALLOWLIST].filter((p) => !unprotected.includes(p)).sort()
    assert.deepEqual(
      unexpected,
      [],
      `new unprotected leftover files:\n${unexpected.join('\n')}`,
    )
    assert.deepEqual(
      missing,
      [],
      `unprotected allowlist entry gained Prisma hints or lost prepare (remove from UNPROTECTED_ALLOWLIST):\n${missing.join('\n')}`,
    )
  })

  it('spot-checks U6 facade cleared; CLI waivers only remain', () => {
    const hits = new Set(leftoverPaths())
    assert.ok(!hits.has('db/query.ts'), 'db/query.ts facade should be deleted after U6')
    assert.ok(!hits.has('db/index.ts'), 'db/index.ts should have no prepare/query after U6')
    assert.ok(!hits.has('routes/skills.ts'), 'skills.ts should be cleared after U5')
    assert.ok(!hits.has('routes/proposals.ts'), 'proposals.ts should be cleared after U5')
    assert.ok(!hits.has('routes/sync.ts'), 'sync.ts should be cleared after U5')
    assert.ok(!hits.has('scanner/cache.ts'), 'scanner/cache.ts should be cleared after U5')
    assert.ok(!hits.has('sync/sync-repo.ts'), 'sync-repo.ts should be cleared after U5')
    assert.equal(hits.size, LEFTOVER_ALLOWLIST.size)
  })

  it('detects typed query call sites (generics between name and paren)', () => {
    assert.ok(
      SQLITE_CALL_RE.test('const rows = query<{ path: string }>(db, sql)'),
      'query<T>( should match',
    )
    assert.ok(
      SQLITE_CALL_RE.test('const row = queryOne<VersionLabel>(db, sql)'),
      'queryOne<T>( should match',
    )
    assert.ok(
      !SQLITE_CALL_RE.test('const name = "queryOne"'),
      'string mentioning queryOne without a call should not match',
    )
  })
})
