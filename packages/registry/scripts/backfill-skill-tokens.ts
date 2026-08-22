/**
 * Backfill context-weight token counts on skill_versions rows that predate the
 * feature (token_count IS NULL). Idempotent: only null rows are touched unless
 * `--all` forces a recompute of every row. SKILL.md bytes come from the same
 * blob store the server uses (`createBlobStore`), so this works against the
 * MySQL blobs table locally and R2 in prod. token_bundle is left null (v1.1).
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/backfill-skill-tokens.ts             # backfill null rows
 *   npx tsx --env-file-if-exists=.env scripts/backfill-skill-tokens.ts --dry-run   # report only, no writes
 *   npx tsx --env-file-if-exists=.env scripts/backfill-skill-tokens.ts --all       # recompute every row
 */
import { pathToFileURL } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../src/db/prisma-client.js'
import { createBlobStore } from '../src/blob-store/index.js'
import { loadBundleForVersionPrisma } from '../src/blob-store/load-bundle.js'
import { computeSkillTokens } from '../src/lib/skill-tokens.js'
import type { DatabaseSync } from '../src/db/sqlite-handle.js'

type BlobStoreArg = Parameters<typeof loadBundleForVersionPrisma>[1]

export interface BackfillTokensStats {
  /** Rows selected for backfill (null token_count, or all rows under --all). */
  candidates: number
  /** Rows whose token columns were written. */
  updated: number
  /** Rows skipped because their SKILL.md blob could not be loaded. */
  noBundle: number
}

export interface BackfillTokensOptions {
  dryRun?: boolean
  all?: boolean
  log?: (message: string) => void
}

/**
 * Recompute and persist token columns for skill versions. Exported for tests;
 * the CLI wrapper below supplies a live prisma + blob store.
 */
export async function backfillSkillTokens(
  prisma: PrismaClient,
  blobStore: BlobStoreArg,
  options: BackfillTokensOptions = {},
): Promise<BackfillTokensStats> {
  const log = options.log ?? (() => {})
  const baseWhere = options.all ? {} : { token_count: null }
  const total = await prisma.skill_versions.count({ where: baseWhere })
  log(`${total} version(s) to backfill${options.all ? ' (--all)' : ''}`)
  if (options.dryRun) {
    log('dry run: no rows written')
    return { candidates: total, updated: 0, noBundle: 0 }
  }

  // Keyset-paginate on the composite key (skill_id, hash) so memory stays
  // bounded on a large skill_versions table. A manual range predicate (not a
  // Prisma cursor) is used because updated rows leave the `token_count IS NULL`
  // set mid-run; advancing `last` past every processed row keeps blob-missing
  // rows (which stay null) from being re-selected in the same pass.
  const BATCH = 500
  let updated = 0
  let noBundle = 0
  let processed = 0
  let last: { skill_id: string; hash: string } | undefined
  for (;;) {
    const keyset = last
      ? {
          OR: [
            { skill_id: { gt: last.skill_id } },
            { skill_id: last.skill_id, hash: { gt: last.hash } },
          ],
        }
      : undefined
    const batch = await prisma.skill_versions.findMany({
      where: keyset ? { AND: [baseWhere, keyset] } : baseWhere,
      select: { skill_id: true, hash: true },
      orderBy: [{ skill_id: 'asc' }, { hash: 'asc' }],
      take: BATCH,
    })
    if (batch.length === 0) break
    for (const v of batch) {
      const bundle = await loadBundleForVersionPrisma(prisma, blobStore, v.hash)
      const skillMdBytes = bundle?.get('SKILL.md')
      if (!skillMdBytes) {
        noBundle++
        log(`  skip (SKILL.md missing): ${v.skill_id} ${v.hash}`)
      } else {
        const t = computeSkillTokens(Buffer.from(skillMdBytes).toString('utf8'))
        await prisma.skill_versions.update({
          where: { skill_id_hash: { skill_id: v.skill_id, hash: v.hash } },
          data: { token_count: t.count, token_ambient: t.ambient, token_method: t.method },
        })
        updated++
      }
      processed++
      if (processed % 100 === 0) log(`  ${processed}/${total}…`)
    }
    last = { skill_id: batch[batch.length - 1].skill_id, hash: batch[batch.length - 1].hash }
    if (batch.length < BATCH) break
  }

  log(`done: ${updated} updated, ${noBundle} skipped (missing SKILL.md)`)
  return { candidates: total, updated, noBundle }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const all = process.argv.includes('--all')
  const prisma = createPrismaClient()
  // No live sqlite handle post-cutover; createBlobStore ignores the db arg when
  // prisma is provided.
  const blobStore = createBlobStore(undefined as unknown as DatabaseSync, prisma)
  await backfillSkillTokens(prisma, blobStore, { dryRun, all, log: (m) => console.log(m) })
  await prisma.$disconnect()
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
