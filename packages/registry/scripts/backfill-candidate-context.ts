/**
 * Capture decision context for mirror-queue rows that predate it.
 *
 * Capture runs at screen time, so the rows already sitting in the queue when
 * that shipped show a score and a skill count and nothing else, which is the
 * state that made the queue hard to drain in the first place. This walks them
 * and fills in the names, categories, and catalog overlap.
 *
 * Idempotent: only rows with `skills_captured_at IS NULL` are touched unless
 * `--all` forces a re-capture. Best-effort per candidate, so one repo that has
 * been deleted or renamed does not stop the pass.
 *
 * Cost: two GitHub API calls per candidate (repo metadata, tree) plus one
 * raw.githubusercontent.com request per skill. The per-skill requests hit a CDN
 * and do not draw on the 5,000/hr API quota; the two per candidate do. Set
 * SKILLET_DISCOVERY_GITHUB_TOKEN to raise that ceiling from 60/hr.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/backfill-candidate-context.ts
 *   npx tsx --env-file-if-exists=.env scripts/backfill-candidate-context.ts --dry-run
 *   npx tsx --env-file-if-exists=.env scripts/backfill-candidate-context.ts --all
 *   npx tsx --env-file-if-exists=.env scripts/backfill-candidate-context.ts --limit 10
 */
import { pathToFileURL } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../src/db/prisma-client.js'
import { parseOwnerRepo } from '../src/lib/mirror-screen.js'
import { assessCandidateQuality } from '../src/lib/mirror-quality.js'
import { recordCandidateContext } from '../src/lib/mirror-candidate-context.js'
import {
  OVERLAP_THRESHOLD,
  buildOverlapIndex,
  loadPublicCatalogPrisma,
} from '../src/lib/mirror-overlap.js'
import { DISCOVERY_TOKEN_ENV } from '../src/mirror-ops/discovery.js'

export interface BackfillContextStats {
  /** Rows selected for backfill. */
  candidates: number
  /** Rows that now carry captured skills. */
  captured: number
  /** Rows whose repo could not be read (deleted, renamed, private, throttled). */
  unreadable: number
}

export interface BackfillContextOptions {
  dryRun?: boolean
  all?: boolean
  limit?: number
  token?: string
  /** Injectable fetch for tests (mirrors mirror-screen.ts / discovery.ts). */
  fetchImpl?: typeof fetch
  log?: (message: string) => void
}

export async function backfillCandidateContext(
  prisma: PrismaClient,
  options: BackfillContextOptions = {},
): Promise<BackfillContextStats> {
  const log = options.log ?? (() => {})
  const token = options.token ?? process.env[DISCOVERY_TOKEN_ENV] ?? undefined

  const rows = await prisma.mirror_review_queue.findMany({
    where: {
      status: 'pending_review',
      ...(options.all ? {} : { skills_captured_at: null }),
    },
    orderBy: { created_at: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
    select: { id: true, source_repo: true },
  })
  log(`${rows.length} pending row(s) to capture${options.all ? ' (--all)' : ''}`)
  if (options.dryRun) {
    for (const row of rows) log(`  would capture ${row.source_repo}`)
    return { candidates: rows.length, captured: 0, unreadable: 0 }
  }
  if (rows.length === 0) return { candidates: 0, captured: 0, unreadable: 0 }

  // One catalog read for the whole pass. Overlap is scored against the catalog
  // as it stands right now, which is the same rule screen time follows.
  const index = buildOverlapIndex(await loadPublicCatalogPrisma(prisma))
  log(`catalog: ${index.size} public skills`)

  let captured = 0
  let unreadable = 0
  for (const row of rows) {
    const parsed = parseOwnerRepo(row.source_repo)
    if (!parsed) {
      unreadable++
      log(`  ~ ${row.source_repo}: unparseable source_repo`)
      continue
    }
    const quality = await assessCandidateQuality({
      owner: parsed.owner,
      repo: parsed.repo,
      ...(token ? { token } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
    // The listing is what capture needs; the score is not recomputed into
    // screen_notes here. Re-scoring a row would change what an admin already
    // read on the page, and this pass is meant to add context, not revise it.
    if (!quality.defaultBranch || quality.skillDirs.length === 0) {
      unreadable++
      log(`  ~ ${row.source_repo}: ${quality.hardFail ?? 'no skill directories found'}`)
      continue
    }
    const skills = await recordCandidateContext(
      prisma,
      row.id,
      {
        owner: parsed.owner,
        repo: parsed.repo,
        ref: quality.defaultBranch,
        dirs: quality.skillDirs,
        ...(token ? { token } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
      index,
    )
    if (!skills) {
      unreadable++
      log(`  ~ ${row.source_repo}: nothing readable`)
      continue
    }
    captured++
    const dupes = skills.filter((s) => s.overlapRef != null && (s.overlapScore ?? 0) >= OVERLAP_THRESHOLD).length
    log(`  ✓ ${row.source_repo}: ${skills.length} skill(s), ${dupes} already in the catalog`)
  }

  log(`done: ${captured} captured, ${unreadable} unreadable`)
  return { candidates: rows.length, captured, unreadable }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const all = process.argv.includes('--all')
  const limitAt = process.argv.indexOf('--limit')
  const limit = limitAt >= 0 ? Number(process.argv[limitAt + 1]) : undefined
  const prisma = createPrismaClient()
  await backfillCandidateContext(prisma, {
    dryRun,
    all,
    ...(limit && Number.isFinite(limit) ? { limit } : {}),
    log: (m) => console.log(m),
  })
  await prisma.$disconnect()
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
