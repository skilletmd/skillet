/**
 * Re-attest skill versions whose signing key no longer exists.
 *
 * A platform-key rotation (or a dev DB reset that minted a fresh key) leaves
 * versions signed by a key id that resolves in neither `author_keys` nor
 * `platform_keys`. The serve routes then return no author identity and every
 * client pull fails closed with `author_not_claimed`. This strips the orphaned
 * signatures and re-signs those versions with the CURRENT platform key — the
 * same attestation `sync-repo` applies to freshly mirrored versions.
 *
 *   cd packages/registry
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/reattest-orphaned-signatures.ts             # re-sign
 *   npx tsx scripts/reattest-orphaned-signatures.ts --dry-run   # report only
 */
import { pathToFileURL } from 'node:url'
import { createPrismaClient } from '../src/db/prisma-client.js'
import { attestVersionRowIfUnsignedPrisma } from '../src/lib/platform-signing.js'

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const prisma = createPrismaClient()

  const known = new Set<string>([
    ...(await prisma.author_keys.findMany({ select: { key_id: true } })).map((r) => r.key_id),
    ...(await prisma.platform_keys.findMany({ select: { key_id: true } })).map((r) => r.key_id),
  ])
  const versions = await prisma.skill_versions.findMany({
    select: { skill_id: true, hash: true, author_key_id: true },
  })
  const orphaned = versions.filter((v) => v.author_key_id != null && !known.has(v.author_key_id))
  console.log(`${versions.length} versions total, ${orphaned.length} signed by an unknown key`)
  if (dryRun || orphaned.length === 0) return

  let reattested = 0
  for (const v of orphaned) {
    // skill_id is `<author>:<slug>`; the attestation ref is `@author/slug`.
    const [author, slug] = v.skill_id.split(':')
    if (!author || !slug) {
      console.log(`  skip (unparseable skill id): ${v.skill_id}`)
      continue
    }
    await prisma.skill_versions.updateMany({
      where: { skill_id: v.skill_id, hash: v.hash },
      data: {
        signature_alg: null,
        signature_key_id: null,
        signature_b64: null,
        author_key_id: null,
      },
    })
    const ok = await attestVersionRowIfUnsignedPrisma(prisma, {
      skillId: v.skill_id,
      hash: v.hash,
      ref: `@${author}/${slug}`,
    })
    if (ok) reattested++
    if (reattested % 200 === 0 && reattested > 0) console.log(`  ${reattested}/${orphaned.length}…`)
  }
  console.log(`done: ${reattested}/${orphaned.length} re-attested with the current platform key`)
  await prisma.$disconnect()
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
