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
 *
 * Against a REMOTE registry, that single-process form cannot run: `claude` only
 * exists on a workstation, the authors only exist in the server's database, and
 * bridging the two by copying a database credential onto the workstation is the
 * wrong direction to move a secret. So the work moves instead, the same three
 * steps `backfill-categories-ai.ts` already splits into:
 *
 *   ssh prod  '… scripts/backfill-suggestions.ts --export --limit 5' > work.json
 *   local     '… scripts/backfill-suggestions.ts --phrase work.json'  > lines.json
 *   ssh prod  '… scripts/backfill-suggestions.ts --import' < lines.json
 *
 * `--export` selects the authors and clusters their kits (public, listed skills
 * only — the same privacy boundary the in-process path draws), `--phrase` is
 * the workstation half and touches no database, and `--import` applies the
 * result. Read `lines.json` before importing: it is the copy that will appear
 * under someone's name, and this is the last point at which it is cheap to
 * drop a line.
 *
 * `--import` re-checks every row it writes: an author who edited their own
 * lines is never overwritten, an author who gained a set since the export is
 * left alone unless `--all` is passed, and a ref that does not belong to the
 * author it is keyed under is refused. A stale or hand-edited map therefore
 * cannot do damage a re-export would not fix.
 */
import { readFileSync } from 'node:fs'
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
  isPublishablePhrase,
  type ClusterableSkill,
  type SuggestionCluster,
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

/** One author's phrasing input: everything the CLI half needs, and no more. */
export interface SuggestionWorkItem {
  /** Author handle. Also the key the phrased map comes back under. */
  id: string
  kit_signature: string
  clusters: SuggestionCluster[]
  /** Public, listed skills the author has — reported when no line is possible. */
  kit_size: number
}

export interface SuggestionWork {
  items: SuggestionWorkItem[]
  /** Authors the query returned, before the skip rules ran. */
  authors: number
  /** Authors dropped: they edited their own lines, or `--stale` saw no drift. */
  skipped: number
}

/**
 * The selection pass, shared by the in-process backfill and `--export`.
 *
 * Both halves have to apply exactly the same rules — an export that selected a
 * wider set than the direct run would quietly route authors around the
 * edited-is-terminal guard.
 */
export async function selectSuggestionWork(
  prisma: PrismaClient,
  opts: BackfillSuggestionsOptions = {},
): Promise<SuggestionWork> {
  const log = opts.log ?? (() => {})
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

  const items: SuggestionWorkItem[] = []
  let skipped = 0

  for (const author of authors) {
    // An edited set is terminal in both modes. Regenerating over someone's own
    // correction is the one failure this feature cannot afford.
    if (author.suggestions_edited_at != null) {
      skipped++
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
      skipped++
      continue
    }

    items.push({
      id: author.id,
      kit_signature: signature,
      clusters: clusterSkills(kit),
      kit_size: kit.length,
    })
  }

  return { items, authors: authors.length, skipped }
}

export async function backfillSuggestions(
  prisma: PrismaClient,
  opts: BackfillSuggestionsOptions = {},
): Promise<BackfillSuggestionsStats> {
  const log = opts.log ?? (() => {})
  const phrase = opts.phrase ?? suggestBatchViaClaudeCli
  const work = await selectSuggestionWork(prisma, opts)
  const stats: BackfillSuggestionsStats = {
    authors: work.authors,
    generated: 0,
    empty: 0,
    skipped: work.skipped,
    failed: 0,
  }

  for (const item of work.items) {
    let suggestions: SummonSuggestion[] = []
    if (item.clusters.length > 0) {
      try {
        suggestions = await phrase(item.clusters)
      } catch (err) {
        // One author's failure is not the run's. They stay null and retry.
        stats.failed++
        log(`  ! @${item.id}: ${err instanceof Error ? err.message : 'phrasing failed'}`)
        continue
      }
    }

    if (suggestions.length === 0) stats.empty++
    else stats.generated++

    for (const s of suggestions) log(`  /skillet @${item.id} ${s.task}   <- ${s.ref}`)
    if (suggestions.length === 0) log(`  - @${item.id}: no confident line (${item.kit_size} skills)`)

    if (opts.dryRun) continue
    await prisma.authors.update({
      where: { id: item.id },
      data: {
        suggestions: serializeSummonSuggestionSet({
          suggestions,
          kit_signature: item.kit_signature,
        }),
        suggestions_generated_at: Math.floor(Date.now() / 1000),
      },
    })
  }

  return stats
}

/** `--phrase` output: author handle -> the set `--import` will store. */
export type SuggestionPhraseMap = Record<
  string,
  { suggestions: SummonSuggestion[]; kit_signature: string }
>

/**
 * The workstation half. Touches no database: it reads exported work and writes
 * a map, so the only thing crossing the machine boundary in either direction is
 * public copy.
 */
export async function phraseExportedWork(
  items: SuggestionWorkItem[],
  phrase: (clusters: SuggestionCluster[]) => Promise<SummonSuggestion[]> = suggestBatchViaClaudeCli,
  log: (message: string) => void = () => {},
): Promise<SuggestionPhraseMap> {
  const out: SuggestionPhraseMap = {}
  for (const item of items) {
    // No cluster means no call. The empty set is still a real outcome and is
    // still stored, which is what stops the next run paying for this author.
    if (item.clusters.length === 0) {
      out[item.id] = { suggestions: [], kit_signature: item.kit_signature }
      log(`  - @${item.id}: no confident line (${item.kit_size} skills)`)
      continue
    }
    try {
      const suggestions = await phrase(item.clusters)
      out[item.id] = { suggestions, kit_signature: item.kit_signature }
      for (const sug of suggestions) log(`  /skillet @${item.id} ${sug.task}   <- ${sug.ref}`)
      if (suggestions.length === 0) log(`  - @${item.id}: no publishable phrase`)
    } catch (err) {
      // Absent from the map entirely, so the author stays null and the next
      // export picks them up. A failed phrasing must never store an empty set:
      // empty means "asked, nothing to say", not "never asked".
      log(`  ! @${item.id}: ${err instanceof Error ? err.message : 'phrasing failed'}`)
    }
  }
  return out
}

export interface ImportSuggestionsStats {
  applied: number
  /** Entries the guards refused, or rows that had already moved on. */
  skipped: number
}

/**
 * Apply a phrased map.
 *
 * Every entry is re-checked here rather than trusted, because the map arrived
 * as a file: refs are verified to belong to the author they are keyed under,
 * phrases go back through `isPublishablePhrase`, and each write is guarded on
 * the row still being in the state the export saw.
 */
export async function importPhrasedSuggestions(
  prisma: PrismaClient,
  map: SuggestionPhraseMap,
  opts: { all?: boolean; log?: (message: string) => void } = {},
): Promise<ImportSuggestionsStats> {
  const log = opts.log ?? (() => {})
  const stats: ImportSuggestionsStats = { applied: 0, skipped: 0 }

  for (const [id, entry] of Object.entries(map)) {
    if (!entry || typeof entry.kit_signature !== 'string' || !Array.isArray(entry.suggestions)) {
      stats.skipped++
      log(`  ! @${id}: malformed entry`)
      continue
    }

    // A ref keyed under the wrong author would put one person's skill on
    // another person's profile. Cheap to check, and the file is the only place
    // the two could ever have come apart.
    const prefix = `@${id}/`
    const bad = entry.suggestions.find(
      (sug) =>
        typeof sug?.ref !== 'string' ||
        !sug.ref.startsWith(prefix) ||
        typeof sug?.task !== 'string' ||
        !isPublishablePhrase(sug.task),
    )
    if (bad) {
      stats.skipped++
      log(`  ! @${id}: refused (${JSON.stringify(bad).slice(0, 80)})`)
      continue
    }

    const result = await prisma.authors.updateMany({
      where: {
        id,
        // Terminal in every mode, --all included.
        suggestions_edited_at: null,
        // Without --all this is a fill, not an overwrite: an author who gained
        // a set between export and import keeps it.
        ...(opts.all ? {} : { suggestions: null }),
      },
      data: {
        suggestions: serializeSummonSuggestionSet({
          suggestions: entry.suggestions,
          kit_signature: entry.kit_signature,
        }),
        suggestions_generated_at: Math.floor(Date.now() / 1000),
      },
    })

    if (result.count > 0) stats.applied++
    else {
      stats.skipped++
      log(`  ~ @${id}: row moved since export, left alone`)
    }
  }

  return stats
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): boolean => argv.includes(`--${name}`)
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? undefined : argv[i + 1]
  }

  const dryRun = flag('dry-run')
  const limitRaw = value('limit')
  const handle = value('handle')?.replace(/^@/, '')
  const selection: BackfillSuggestionsOptions = {
    all: flag('all'),
    stale: flag('stale'),
    ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
    ...(handle ? { handle } : {}),
  }

  // --phrase is the workstation half of the split run: no database, no env,
  // just the exported file in and a map out. It is checked first so it never
  // touches createPrismaClient().
  if (flag('phrase')) {
    if (!(await claudeCliAvailable())) {
      console.error('The `claude` CLI is not on PATH. Run this half on a workstation with Claude Code.')
      process.exitCode = 1
      return
    }
    const file = value('phrase')
    if (!file) {
      console.error('--phrase needs the file that --export wrote.')
      process.exitCode = 1
      return
    }
    const items = JSON.parse(readFileSync(file, 'utf8')) as SuggestionWorkItem[]
    // Progress on stderr so stdout stays a clean map to redirect.
    const map = await phraseExportedWork(items, suggestBatchViaClaudeCli, (m) => console.error(m))
    process.stdout.write(JSON.stringify(map, null, 2) + '\n')
    console.error(`\nphrased ${Object.keys(map).length}/${items.length} author(s)`)
    return
  }

  if (flag('export')) {
    const prisma = createPrismaClient()
    try {
      const work = await selectSuggestionWork(prisma, { ...selection, log: (m) => console.error(m) })
      process.stdout.write(JSON.stringify(work.items, null, 2) + '\n')
      console.error(
        `exported ${work.items.length} author(s) of ${work.authors} selected ` +
          `(${work.skipped} skipped)`,
      )
    } finally {
      await prisma.$disconnect()
    }
    return
  }

  if (flag('import')) {
    const map = JSON.parse(readStdin() || '{}') as SuggestionPhraseMap
    const prisma = createPrismaClient()
    try {
      const stats = await importPhrasedSuggestions(prisma, map, {
        all: flag('all'),
        log: (m) => console.log(m),
      })
      const left = await prisma.authors.count({ where: { suggestions: null } })
      console.log(
        `\nApplied ${stats.applied}, skipped ${stats.skipped}. ` +
          `Authors still without suggestions: ${left}.`,
      )
    } finally {
      await prisma.$disconnect()
    }
    return
  }

  if (!dryRun && !(await claudeCliAvailable())) {
    console.error('The `claude` CLI is not on PATH. Phrasing runs through it; install it or use --dry-run.')
    console.error('Against a remote registry, use the split run instead: --export | --phrase | --import.')
    process.exitCode = 1
    return
  }

  const prisma = createPrismaClient()
  try {
    const stats = await backfillSuggestions(prisma, {
      ...selection,
      dryRun,
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
