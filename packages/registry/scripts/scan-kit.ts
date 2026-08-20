/**
 * One-off: run the real scan + capability detectors over every member of one
 * kit and persist the results to `skill_version_scans` (MySQL/Prisma), so the
 * kit page's TrustPanel renders live capability data.
 *
 *   cd packages/registry
 *   node --env-file=.env --import tsx scripts/scan-kit.ts <kit-slug>
 *
 * Idempotent: re-running rescans and upserts. Reads bundle bytes from the blob
 * store (same bytes the server serves), so results match production scans.
 */
import { pathToFileURL } from 'node:url'
import { createPrismaClient } from '../src/db/prisma-client.js'
import { loadBundleForVersionPrisma } from '../src/blob-store/load-bundle.js'
import { resolveScanCachedPrisma } from '../src/scanner/runner.js'
import {
  persistVersionScanPrisma,
  updateSkillLatestOnPublishPrisma,
  rebalanceAfterScanPrisma,
} from '../src/lib/skill-publish.js'

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'scientific-agent-skills'
  const prisma = createPrismaClient()
  // Minimal read-only store: pull inline blob bytes straight from MySQL
  // (storage_loc=inline). MemoryBlobStore.get only reads its in-process map, so
  // it can't serve seeded bytes; this reads the column directly, trying both
  // hash forms (bare / sha256:-prefixed).
  const blobStore = {
    async get(hash: string): Promise<Uint8Array | null> {
      const bare = hash.replace(/^sha256:/, '')
      const row = await prisma.blobs.findFirst({
        where: { hash: { in: [hash, bare, `sha256:${bare}`] } },
        select: { bytes: true },
      })
      return row?.bytes ? new Uint8Array(row.bytes) : null
    },
    async has(hash: string): Promise<boolean> {
      return (await this.get(hash)) != null
    },
    async put(): Promise<void> {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  const kit = await prisma.kits.findFirst({ where: { slug }, select: { id: true, name: true } })
  if (!kit) throw new Error(`kit not found: ${slug}`)

  const members = await prisma.kit_skills.findMany({
    where: { kit_id: kit.id },
    select: { skill_id: true, pinned_hash: true, skills: { select: { latest_hash: true, slug: true } } },
  })
  console.log(`Scanning ${members.length} skills in "${kit.name}"…`)

  let scanned = 0
  let withCaps = 0
  let skipped = 0
  const capCounts = new Map<string, number>()

  let promoted = 0
  for (const m of members) {
    const label = m.skills?.slug ?? m.skill_id
    // A member whose skill was never promoted to `latest` (seeded/imported but
    // not published-through: bundle present, but latest_hash null and no scan
    // row). The old code skipped these outright, so they stayed unscanned and
    // unservable forever. Fall back to the actual published version instead.
    const wasNeverPromoted = !m.pinned_hash && !m.skills?.latest_hash
    let hash = m.pinned_hash ?? m.skills?.latest_hash ?? null
    if (!hash) {
      const v = await prisma.skill_versions.findFirst({
        where: { skill_id: m.skill_id, yanked_at: null },
        orderBy: { published_at: 'desc' },
        select: { hash: true },
      })
      hash = v?.hash ?? null
    }
    if (!hash) {
      skipped++
      continue
    }
    try {
      const bundle = await loadBundleForVersionPrisma(prisma, blobStore, hash)
      if (!bundle) {
        console.log(`  · ${label}: no bundle`)
        skipped++
        continue
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = await resolveScanCachedPrisma(prisma as any, bundle)
      if (!resolved) {
        skipped++
        continue
      }
      try {
        await persistVersionScanPrisma(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prisma as any,
          m.skill_id,
          hash,
          resolved.result.status,
          resolved.findingsJson,
          resolved.capabilitiesJson,
        )
      } catch (persistErr) {
        // Some mirror skills overflow the findings_json column; the capability
        // panel only needs capabilities_json, so retry with empty findings.
        if (/too long/i.test((persistErr as Error).message)) {
          await persistVersionScanPrisma(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prisma as any,
            m.skill_id,
            hash,
            resolved.result.status,
            '[]',
            resolved.capabilitiesJson,
          )
        } else {
          throw persistErr
        }
      }
      scanned++
      // Repair: a never-promoted member now has a real scan row, so finish the
      // publish it never got — point `latest_hash` at this version, then let the
      // standard rebalance pull it back if the scan came back quarantined. Only
      // touches members that were never promoted, so re-runs never disturb the
      // rest of the kit.
      if (wasNeverPromoted) {
        await updateSkillLatestOnPublishPrisma(prisma as any, m.skill_id, hash, null) // eslint-disable-line @typescript-eslint/no-explicit-any
        await rebalanceAfterScanPrisma(prisma as any, m.skill_id, hash, resolved.result.status) // eslint-disable-line @typescript-eslint/no-explicit-any
        promoted++
      }
      const caps = resolved.capabilitiesJson
        ? ((JSON.parse(resolved.capabilitiesJson).capabilities ?? []) as { capability: string }[])
        : []
      if (caps.length > 0) {
        withCaps++
        for (const c of caps) capCounts.set(c.capability, (capCounts.get(c.capability) ?? 0) + 1)
      }
      console.log(
        `  ✓ ${label}: ${resolved.result.status}${wasNeverPromoted ? ' · promoted' : ''}${caps.length ? ` · caps: ${caps.map((c) => c.capability).join(', ')}` : ''}`,
      )
    } catch (err) {
      console.log(`  ✗ ${label}: ${(err as Error).message}`)
      skipped++
    }
  }

  console.log(
    `\nDone. scanned=${scanned} withCapabilities=${withCaps} promoted=${promoted} skipped=${skipped}`,
  )
  console.log('Capability tallies across the kit:')
  for (const [cap, n] of [...capCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cap}: ${n}`)
  }
  await prisma.$disconnect()
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
