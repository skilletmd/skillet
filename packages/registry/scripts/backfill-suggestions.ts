/**
 * Generate summon suggestions for authors that have none.
 *
 * Every profile that can support three `/skillet @handle <task>` lines should
 * have them, not only authors who publish after the feature ships. This walks
 * the catalog and fills them in.
 *
 * Phrasing shells out to the local `claude` CLI, reusing the operator's Claude
 * Code auth — no ANTHROPIC_API_KEY and no metered spend. That is why this is a
 * script and not a server job: the registry has no `claude` binary.
 *
 * Idempotent and resumable. Only authors with `suggestions IS NULL` are
 * selected unless `--all` forces a re-run, and an author who has edited their
 * own lines is skipped in both modes — an edited set is terminal.
 *
 * An author whose kit cannot support a confident line stores an EMPTY set, not
 * null. That is a real outcome, and storing it is what stops the next run
 * paying for the same author again.
 *
 * The output is public copy attached to real people's names. Stage it:
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/backfill-suggestions.ts --dry-run --limit 5
 *   npx tsx --env-file-if-exists=.env scripts/backfill-suggestions.ts --limit 5
 *   npx tsx --env-file-if-exists=.env scripts/backfill-suggestions.ts
 *   npx tsx --env-file-if-exists=.env scripts/backfill-suggestions.ts --handle wshobson
 *   npx tsx --env-file-if-exists=.env scripts/backfill-suggestions.ts --stale
 */
import { pathToFileURL } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import {
  kitSignature,
  parseSummonSuggestionSet,
  serializeSummonSuggestionSet,
  signatureDrifted,
  type SummonSuggestion,
} from '@skillet/protocol'
import { createPrismaClient } from '../src/db/prisma-client.js'
import {
  clusterSkills,
  effectiveCategory,
  type ClusterableSkill,
} from '../src/suggestions/cluster.js'
import { suggestBatchViaClaudeCli } from './lib/claude-cli-suggest.js'
import { claudeCliAvailable } from './lib/claude-cli.js'

export interface BackfillSuggestionsStats {
  /** Authors selected for this run. */
  authors: number
  /** Authors that now carry at least one suggestion. */
  generated: number
  /** Authors whose kit could not support a confident line (empty set stored). */
  empty: number
  /** Authors skipped because they edited their own lines, or are still fresh. */
  skipped: number
  /** Authors whose phrasing call failed; they stay null and retry next run. */
  failed: number
}

export interface BackfillSuggestionsOptions {
  dryRun?: boolean
  /** Re-generate authors that already have a set (never an edited one). */
  all?: boolean
  /** Re-generate only authors whose kit has changed shape since generation. */
  stale?: boolean
  limit?: number
  /** Restrict the run to one author. */
  handle?: string
  /** Injectable phrasing, so tests never shell out. */
  phrase?: (clusters: ReturnType<typeof clusterSkills>) => Promise<SummonSuggestion[]>
  log?: (message: string) => void
}

/** Public, listed skills for one author, shaped for clustering. */
async function loadKit(prisma: PrismaClient, authorId: string): Promise<ClusterableSkill[]> {
  const rows = await prisma.skills.findMany({
    where: {
      author_id: authorId,
      visibility: 'public',
      moderation_status: { not: 'unlisted' },
    },
    select: {
      slug: true,
      description: true,
      category: true,
      install_count: true,
      created_at: true,
    },
  })
  return rows.map((r) => ({
    ref: `@${authorId}/${r.slug}`,
    slug: r.slug,
    description: r.description ?? null,
    category: r.category ?? null,
    install_count: r.install_count ?? 0,
    created_at: r.created_at ?? 0,
  }))
}

export async function backfillSuggestions(
  prisma: PrismaClient,
  opts: BackfillSuggestionsOptions = {},
): Promise<BackfillSuggestionsStats> {
  const log = opts.log ?? (() => {})
  const phrase = opts.phrase ?? suggestBatchViaClaudeCli
  const stats: BackfillSuggestionsStats = {
    authors: 0,
    generated: 0,
    empty: 0,
    skipped: 0,
    failed: 0,
  }

  const authors = await prisma.authors.findMany({
    where: {
      ...(opts.handle ? { id: opts.handle } : {}),
      ...(opts.all || opts.stale ? {} : { suggestions: null }),
    },
    // Deterministic, so a staged --limit run walks the same authors each time.
    orderBy: { id: 'asc' },
    ...(opts.limit ? { take: opts.limit } : {}),
    select: { id: true, suggestions: true, suggestions_edited_at: true },
  })
  stats.authors = authors.length

  for (const author of authors) {
    // An edited set is terminal in both modes. Regenerating over someone's own
    // correction is the one failure this feature cannot afford.
    if (author.suggestions_edited_at != null) {
      stats.skipped++
      log(`  ~ @${author.id}: edited, skipping`)
      continue
    }

    const kit = await loadKit(prisma, author.id)
    const signature = kitSignature(kit.map((s) => effectiveCategory(s)))

    // `--stale` is the refresh pass. The registry cannot run phrasing itself
    // (no `claude` binary, no key), so keeping suggestions current is an
    // operator job rather than a nightly phase. Signature drift is the whole
    // test: one publish into a large kit is not worth a call, the first skill
    // in a new category is, because that is an area going unrepresented.
    if (opts.stale && !signatureDrifted(parseSummonSuggestionSet(author.suggestions)?.kit_signature, signature)) {
      stats.skipped++
      continue
    }

    const clusters = clusterSkills(kit)

    let suggestions: SummonSuggestion[] = []
    if (clusters.length > 0) {
      try {
        suggestions = await phrase(clusters)
      } catch (err) {
        // One author's failure is not the run's. They stay null and retry.
        stats.failed++
        log(`  ! @${author.id}: ${err instanceof Error ? err.message : 'phrasing failed'}`)
        continue
      }
    }

    if (suggestions.length === 0) stats.empty++
    else stats.generated++

    for (const s of suggestions) log(`  /skillet @${author.id} ${s.task}   <- ${s.ref}`)
    if (suggestions.length === 0) log(`  - @${author.id}: no confident line (${kit.length} skills)`)

    if (opts.dryRun) continue
    await prisma.authors.update({
      where: { id: author.id },
      data: {
        suggestions: serializeSummonSuggestionSet({ suggestions, kit_signature: signature }),
        suggestions_generated_at: Math.floor(Date.now() / 1000),
      },
    })
  }

  return stats
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): boolean => argv.includes(`--${name}`)
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? undefined : argv[i + 1]
  }

  const dryRun = flag('dry-run')
  if (!dryRun && !(await claudeCliAvailable())) {
    console.error('The `claude` CLI is not on PATH. Phrasing runs through it; install it or use --dry-run.')
    process.exitCode = 1
    return
  }

  const limitRaw = value('limit')
  const prisma = createPrismaClient()
  try {
    const stats = await backfillSuggestions(prisma, {
      dryRun,
      all: flag('all'),
      stale: flag('stale'),
      ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
      ...(value('handle') ? { handle: value('handle')!.replace(/^@/, '') } : {}),
      log: (m) => console.log(m),
    })
    console.log(
      `\n${dryRun ? '[dry run] ' : ''}${stats.authors} authors: ` +
        `${stats.generated} generated, ${stats.empty} empty, ` +
        `${stats.skipped} skipped, ${stats.failed} failed`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main()
}
