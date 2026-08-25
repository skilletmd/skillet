// Two guards on the nightly mirror job, both added after prod evidence.
//
// Between 2026-08-22 and 2026-08-25 every 06:00 cron firing skipped and every
// real run was a deploy restart, and three consecutive runs exited 1 for one
// repo that had been deleted from GitHub months earlier.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const script = readFileSync(join(root, 'scripts/nightly-mirror-ops.ts'), 'utf8')
const nightly = readFileSync(join(root, 'src/mirror-ops/nightly.ts'), 'utf8')
const syncRepo = readFileSync(join(root, 'src/sync/sync-repo.ts'), 'utf8')
const ecosystem = readFileSync(join(root, '../../ecosystem.config.cjs'), 'utf8')

describe('a deploy must not trigger a crawl', () => {
  it('skips unless it is the scheduled hour', () => {
    // The min-interval guard could not do this alone: on deploy the stamp is
    // usually stale, so the DEPLOY took the full crawl and the cron then
    // skipped as "too recent". The clock is the only signal PM2 leaves us.
    assert.match(script, /SCHEDULED_HOUR/)
    assert.match(script, /not the scheduled hour/)
  })

  it('keeps the min-interval floor as well', () => {
    assert.match(script, /MIN_INTERVAL_HOURS/)
  })

  it('still lets a human force a run', () => {
    // Both guards are bypassed by --force, or the job becomes unrunnable by hand.
    const forceChecks = script.match(/!force/g) ?? []
    assert.ok(forceChecks.length >= 2, 'every guard should honor --force')
  })

  it('agrees with the PM2 cron expression', () => {
    // Two places, one schedule. If these drift the job silently never runs:
    // PM2 restarts at its hour, the script declines because it is not its hour.
    const cron = /cron_restart:\s*"0 (\d+) \* \* \*"/.exec(ecosystem)
    assert.ok(cron, 'mirror-nightly should carry a cron_restart')
    const fallback = /SCHEDULED_HOUR\s*=\s*Number\(process\.env\.\w+\s*\?\?\s*(\d+)\)/.exec(script)
    assert.ok(fallback, 'SCHEDULED_HOUR should have a literal default')
    assert.equal(fallback[1], cron[1], 'script hour and PM2 cron hour must match')
  })
})

describe('a deleted repo must not hold the exit code red', () => {
  it('has a distinct error for a repo that is gone', () => {
    assert.match(syncRepo, /class GitHubRepoGoneError/)
    assert.match(syncRepo, /res\.status === 404.*GitHubRepoGoneError/s)
  })

  it('counts it as gone, not failed', () => {
    // `failed` drives the exit code. A 404 can never succeed on retry, so
    // counting it there kept the job red for something nobody could fix, and
    // hid whether anything real was failing.
    assert.match(nightly, /result\.gone\+\+/)
    const goneBlock = /GitHubRepoGoneError\)\s*\{[\s\S]*?continue;/.exec(nightly)
    assert.ok(goneBlock, 'phase 2 should handle GitHubRepoGoneError')
    assert.doesNotMatch(goneBlock[0], /result\.failed\+\+/)
  })

  it('retires the queue row so it is not retried forever', () => {
    // Phase 2 only picks up `status: live`, so this also stops the daily
    // wasted GitHub call.
    assert.match(nightly, /status: 'gone'/)
    assert.match(nightly, /mirror_review_queue[\s\S]{0,200}updateMany/)
  })

  it('does not retire anything on a dry run', () => {
    const goneBlock = /GitHubRepoGoneError\)\s*\{[\s\S]*?continue;/.exec(nightly)
    assert.match(goneBlock[0], /!opts\.dryRun/)
  })

  it('reports the count in the machine-readable summary', () => {
    assert.match(nightly, /gone: phase2\.gone/)
  })
})
