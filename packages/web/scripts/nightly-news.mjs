#!/usr/bin/env node
/**
 * Nightly Skillet Daily — collect the day's signal, then write the stories.
 *
 * Run by PM2 (cron_restart, see ecosystem.config.cjs); safe to run by hand:
 *
 *   cd packages/web
 *   node --env-file-if-exists=.env scripts/nightly-news.mjs [--dry-run]
 *   ... --force            # run even off-hour / soon after the last run
 *
 * PM2 starts a `cron_restart` app IMMEDIATELY on (re)start as well as on the
 * schedule, so without a guard every `pm2 startOrReload` would spend a fresh
 * round of X search calls and Opus tokens nobody asked for. Same two guards as
 * mirror-nightly, and for the same reason it learned them:
 *
 *   1. SCHEDULED HOUR. A deploy at any other hour exits in milliseconds. This
 *      is the guard that actually stops deploy-triggered runs; keep the hour in
 *      lockstep with `cron_restart` in ecosystem.config.cjs.
 *   2. MIN INTERVAL. A floor on frequency, for a double-fire inside the hour.
 *
 * The two phases are ordered and gated: drafting reads the seed file the
 * collector writes, so a failed collect must NOT fall through to drafting.
 * That would write today's edition from yesterday's posts, which is the one
 * failure a reader cannot detect.
 *
 * Env: everything collect-signal.mjs and draft-stories.mjs need
 * (TWITTERAPI_IO_KEY, REGISTRY_URL, ANTHROPIC_API_KEY).
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** A completed run inside this window makes the next start a no-op. Half a day:
 *  comfortably under the 24h cron gap, so a real firing never trips it. */
const MIN_INTERVAL_HOURS = 12
/** Must match `cron_restart` for news-nightly in ecosystem.config.cjs. Local
 *  hour, because that is what PM2's cron expression is evaluated in. */
const SCHEDULED_HOUR = Number(process.env.SKILLET_NEWS_HOUR ?? 7)

/** Beside the PM2 logs, so it is untracked and survives a rebuild. Resolved
 *  from this file, not cwd, so a hand-run reads the stamp PM2's run wrote. */
const STAMP = path.join(HERE, '..', '..', '..', 'logs', 'news-nightly-last-run')

const FORCE = process.argv.includes('--force')
const DRY_RUN = process.argv.includes('--dry-run')

function hoursSinceLastRun() {
  try {
    const then = Number(readFileSync(STAMP, 'utf8').trim())
    return Number.isFinite(then) ? (Date.now() - then) / 3_600_000 : null
  } catch {
    return null // never run, or unreadable — treat as due
  }
}

function stampRun() {
  try {
    mkdirSync(path.dirname(STAMP), { recursive: true })
    writeFileSync(STAMP, String(Date.now()), 'utf8')
  } catch (err) {
    // A missing stamp only costs an extra run; never fail the job over it.
    console.warn(`could not write run stamp: ${err.message}`)
  }
}

/** Resolves to the exit code. Output is inherited so both phases land in one
 *  PM2 log in order, which is what makes a bad edition diagnosable after. */
const run = (script, args = []) =>
  new Promise((resolve) => {
    console.log(`\n$ node scripts/${script} ${args.join(' ')}`.trimEnd())
    spawn(process.execPath, [path.join(HERE, script), ...args], {
      cwd: path.join(HERE, '..'),
      stdio: 'inherit',
      env: process.env,
    }).on('close', resolve)
  })

async function main() {
  const hour = new Date().getHours()
  if (!FORCE && hour !== SCHEDULED_HOUR) {
    console.log(`not the scheduled hour (${hour} != ${SCHEDULED_HOUR}); exiting.`)
    return 0
  }
  const since = hoursSinceLastRun()
  if (!FORCE && since !== null && since < MIN_INTERVAL_HOURS) {
    console.log(`last run ${since.toFixed(1)}h ago (< ${MIN_INTERVAL_HOURS}h); exiting.`)
    return 0
  }

  const collected = await run('collect-signal.mjs')
  if (collected !== 0) {
    // Drafting from a stale seed would publish today's edition out of
    // yesterday's posts. Fail the run instead; no news is better than fake news.
    console.error(`collect failed (exit ${collected}); not drafting.`)
    return collected
  }

  const drafted = await run('draft-stories.mjs', DRY_RUN ? ['--dry-run'] : [])
  if (drafted !== 0) {
    // The seed is good, so the collect half is worth keeping — a hand-run of
    // draft-stories.mjs can finish the edition without re-spending the API.
    console.error(`drafting failed (exit ${drafted}); seed written, stories not.`)
    return drafted
  }

  if (!DRY_RUN) stampRun()
  console.log('\nnightly news complete')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
