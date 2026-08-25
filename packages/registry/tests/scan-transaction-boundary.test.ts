// Where the harm-scan runs relative to the publish transaction.
//
// Prod, 2026-08-24: mirror sync ran scanBothFresh (a full CPU walk of the
// bundle) inside an interactive transaction, blew Prisma's 5s ceiling on larger
// repos, and dropped the skill from the run:
//
//   ! skipped unified Spielewoy/autoprompt-skill:
//   Transaction already closed ... timeout was 5000 ms, however 6344 ms passed
//
// The skill then went unscanned and unpublished with nothing surfacing it,
// which is the outcome the in-transaction placement existed to prevent.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const syncRepo = readFileSync(join(process.cwd(), 'src/sync/sync-repo.ts'), 'utf8')
const publishRoute = readFileSync(join(process.cwd(), 'src/routes/skills.ts'), 'utf8')

describe('the scan runs before the transaction, not inside it', () => {
  it('resolves the scan ahead of runPrismaTransaction in sync', () => {
    const scanAt = syncRepo.indexOf('resolveScanCachedPrisma(')
    const txAt = syncRepo.indexOf('runPrismaTransaction(prisma, async (tx)')
    assert.ok(scanAt > -1 && txAt > -1, 'both call sites should exist')
    assert.ok(scanAt < txAt, 'the scan must be resolved before the transaction opens')
  })

  it('does not hand the transaction client to the scanner', () => {
    // Passing `tx` is what put the CPU walk inside the transaction.
    assert.doesNotMatch(syncRepo, /resolveScanCachedPrisma\(tx\b/)
  })

  it('matches the publish path, which never had this problem', () => {
    assert.match(publishRoute, /resolveScanCachedPrisma\(prisma\b/)
    assert.match(syncRepo, /resolveScanCachedPrisma\(prisma\b/)
  })
})

describe('but the scan is still written atomically with the version', () => {
  it('persists the scan row inside the transaction', () => {
    // Only the COMPUTE moved out. The write stays atomic with the skill and
    // version upserts, so a committed version always carries its scan row.
    const txAt = syncRepo.indexOf('runPrismaTransaction(prisma, async (tx)')
    const persistAt = syncRepo.indexOf('persistVersionScanPrisma(tx,')
    assert.ok(persistAt > txAt, 'the scan row must be written inside the transaction')
  })

  it('still holds a version that scans dirty', () => {
    // The hold is what keeps a quarantined or secret-bearing version from
    // becoming the installable pointer.
    assert.match(syncRepo, /secretsBlockingScan\(bundle\)/)
    assert.match(syncRepo, /scanResult\.status === 'quarantined'/)
    assert.match(syncRepo, /lastCleanHashPrisma\(tx, skillId\)/)
    assert.match(syncRepo, /blocked_hash: versionHash/)
  })

  it('computes the hold decision before the transaction, from the same inputs', () => {
    const blockedAt = syncRepo.indexOf('const blocked = Boolean(secretHit)')
    const txAt = syncRepo.indexOf('runPrismaTransaction(prisma, async (tx)')
    assert.ok(blockedAt > -1 && blockedAt < txAt, 'blocked should be decided before the transaction')
  })
})
