#!/usr/bin/env node
/**
 * Correlate [browse-ssr] proxy_enter rids with later page_done / featured_done.
 *
 * Proves (or falsifies) "queued after auth, SSR still cheap":
 *   - orphan: proxy_enter, never done in this log window
 *   - late: done_wall - enter_wall is large while done.elapsed_ms stays small
 *
 * Usage:
 *   # paste / file of pm2 logs
 *   node scripts/browse-ssr-rid-correlate.mjs web.log
 *   pm2 logs web --nostream --lines 5000 | node scripts/browse-ssr-rid-correlate.mjs
 *   # single rid
 *   node scripts/browse-ssr-rid-correlate.mjs web.log --rid c9c5b561
 *
 * Env:
 *   LATE_MS   wall gap proxy→done to flag as late (default 5000)
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { stdin as stdinStream } from 'node:process'

const LATE_MS = Math.max(0, Number(process.env.LATE_MS ?? '5000') || 5000)

const DONE_EVENTS = new Set(['page_done', 'featured_done'])

function parseArgs(argv) {
  const files = []
  let ridFilter = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') return { help: true }
    if (a === '--rid') {
      ridFilter = argv[++i] ?? null
      continue
    }
    if (a.startsWith('--rid=')) {
      ridFilter = a.slice('--rid='.length) || null
      continue
    }
    if (a.startsWith('-')) continue
    files.push(a)
  }
  return { files, ridFilter, help: false }
}

/** ISO timestamp from pm2-ish lines: `4|web-2  | 2026-07-17T16:38:14: ...` */
function parseWallMs(line) {
  const m = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  if (!m) return null
  const t = Date.parse(`${m[1]}Z`)
  return Number.isFinite(t) ? t : null
}

/**
 * Pull event name + JSON-ish object after `[browse-ssr]`.
 * Handles both single-line `{ rid: 'abc', ... }` and multi-line objects
 * (we only see one line at a time — multi-line fields may miss rid; see flush).
 */
function parseBrowseSsrLine(line) {
  const idx = line.indexOf('[browse-ssr]')
  if (idx < 0) return null
  const rest = line.slice(idx + '[browse-ssr]'.length).trim()
  const sp = rest.search(/\s/)
  if (sp < 0) return { event: rest, fields: {} }
  const event = rest.slice(0, sp).trim()
  const payload = rest.slice(sp).trim()
  const fields = {}
  // rid: 'xxxxxxxx' or rid: "xxxxxxxx"
  const ridM = payload.match(/\brid:\s*['"]([0-9a-f]{8})['"]/i)
  if (ridM) fields.rid = ridM[1].toLowerCase()
  const pathM = payload.match(/\bpathname:\s*['"]([^'"]+)['"]/)
  if (pathM) fields.pathname = pathM[1]
  const elapsedM = payload.match(/\belapsed_ms:\s*(\d+)/)
  if (elapsedM) fields.elapsed_ms = Number(elapsedM[1])
  const msM = payload.match(/(?:^|[^{\w])ms:\s*(\d+)/)
  if (msM) fields.ms = Number(msM[1])
  const authedM = payload.match(/\bauthed:\s*(true|false)/)
  if (authedM) fields.authed = authedM[1] === 'true'
  const tabM = payload.match(/\btab:\s*['"]([^'"]+)['"]/)
  if (tabM) fields.tab = tabM[1]
  return { event, fields }
}

/**
 * Multi-line util.log objects: event on one line, `rid:` on a following line.
 * Track pending event until we see rid or a new [browse-ssr].
 */
function createParser(state) {
  return (line) => {
    const wall = parseWallMs(line)
    const parsed = parseBrowseSsrLine(line)

    if (parsed) {
      state.pending = {
        event: parsed.event,
        fields: { ...parsed.fields },
        wall,
        line,
      }
      if (parsed.fields.rid) {
        emit(state, state.pending)
        state.pending = null
      }
      return
    }

    // Continuation line of a util.inspect object
    if (state.pending) {
      const ridM = line.match(/\brid:\s*['"]([0-9a-f]{8})['"]/i)
      if (ridM) state.pending.fields.rid = ridM[1].toLowerCase()
      const pathM = line.match(/\bpathname:\s*['"]([^'"]+)['"]/)
      if (pathM) state.pending.fields.pathname = pathM[1]
      const elapsedM = line.match(/\belapsed_ms:\s*(\d+)/)
      if (elapsedM) state.pending.fields.elapsed_ms = Number(elapsedM[1])
      const authedM = line.match(/\bauthed:\s*(true|false)/)
      if (authedM) state.pending.fields.authed = authedM[1] === 'true'
      const tabM = line.match(/\btab:\s*['"]([^'"]+)['"]/)
      if (tabM) state.pending.fields.tab = tabM[1]
      if (wall != null && state.pending.wall == null) state.pending.wall = wall
      if (state.pending.fields.rid) {
        emit(state, state.pending)
        state.pending = null
      }
    }
  }
}

function emit(state, row) {
  const rid = row.fields.rid
  if (!rid) return
  if (state.ridFilter && rid !== state.ridFilter) return

  let rec = state.byRid.get(rid)
  if (!rec) {
    rec = {
      rid,
      enterWall: null,
      doneWall: null,
      pathname: null,
      authed: null,
      doneEvent: null,
      elapsed_ms: null,
      events: [],
    }
    state.byRid.set(rid, rec)
  }
  rec.events.push({ event: row.event, wall: row.wall, ...row.fields })

  if (row.event === 'proxy_enter') {
    if (rec.enterWall == null) rec.enterWall = row.wall
    if (row.fields.pathname) rec.pathname = row.fields.pathname
    if (typeof row.fields.authed === 'boolean') rec.authed = row.fields.authed
  }
  if (DONE_EVENTS.has(row.event)) {
    if (rec.doneWall == null) rec.doneWall = row.wall
    rec.doneEvent = row.event
    if (typeof row.fields.elapsed_ms === 'number') rec.elapsed_ms = row.fields.elapsed_ms
  }
}

function fmtGap(enterWall, doneWall) {
  if (enterWall == null || doneWall == null) return null
  return doneWall - enterWall
}

function summarize(byRid) {
  const orphans = []
  const late = []
  const ok = []
  const doneOnly = []

  for (const rec of byRid.values()) {
    const gap = fmtGap(rec.enterWall, rec.doneWall)
    if (rec.enterWall != null && rec.doneWall == null) {
      orphans.push(rec)
      continue
    }
    if (rec.enterWall == null && rec.doneWall != null) {
      doneOnly.push(rec)
      continue
    }
    if (gap != null && gap >= LATE_MS) {
      late.push({ ...rec, gap_ms: gap })
      continue
    }
    if (rec.enterWall != null && rec.doneWall != null) {
      ok.push({ ...rec, gap_ms: gap })
    }
  }

  orphans.sort((a, b) => (a.enterWall ?? 0) - (b.enterWall ?? 0))
  late.sort((a, b) => b.gap_ms - a.gap_ms)
  ok.sort((a, b) => (b.gap_ms ?? 0) - (a.gap_ms ?? 0))

  return { orphans, late, ok, doneOnly }
}

function printRec(label, rec) {
  const gap = rec.gap_ms ?? fmtGap(rec.enterWall, rec.doneWall)
  const parts = [
    label,
    rec.rid,
    rec.pathname ?? '(no path)',
    rec.authed == null ? 'authed=?' : `authed=${rec.authed}`,
  ]
  if (gap != null) parts.push(`wall_gap_ms=${gap}`)
  if (rec.elapsed_ms != null) parts.push(`ssr_elapsed_ms=${rec.elapsed_ms}`)
  if (rec.doneEvent) parts.push(rec.doneEvent)
  console.log(parts.join('\t'))
}

async function readLines(pathOrNull, onLine) {
  const input = pathOrNull ? createReadStream(pathOrNull, { encoding: 'utf8' }) : stdinStream
  const rl = createInterface({ input, crlfDelay: Infinity })
  for await (const line of rl) onLine(line)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`browse-ssr-rid-correlate — match proxy_enter to page_done/featured_done

Usage:
  node scripts/browse-ssr-rid-correlate.mjs [logfile...] [--rid <8hex>]
  pm2 logs web --nostream --lines 5000 2>&1 | node scripts/browse-ssr-rid-correlate.mjs

Env:
  LATE_MS   wall clock gap to call "late" (default ${LATE_MS})

Columns: kind rid path authed wall_gap_ms ssr_elapsed_ms done_event
  orphan     = proxy_enter, no done in this window
  late       = done, but wall_gap >= LATE_MS (queue before SSR)
  ok         = enter+done, wall_gap < LATE_MS
  done_only  = done without proxy_enter in this window
`)
    process.exit(0)
  }

  const state = {
    byRid: new Map(),
    pending: null,
    ridFilter: args.ridFilter ? args.ridFilter.toLowerCase() : null,
  }
  const onLine = createParser(state)

  if (args.files.length === 0) {
    if (stdinStream.isTTY) {
      console.error('Pass a logfile or pipe pm2 logs on stdin. Try --help.')
      process.exit(2)
    }
    await readLines(null, onLine)
  } else {
    for (const f of args.files) await readLines(f, onLine)
  }
  if (state.pending?.fields?.rid) emit(state, state.pending)

  const { orphans, late, ok, doneOnly } = summarize(state.byRid)

  console.log(
    `rids=${state.byRid.size} orphans=${orphans.length} late(>=${LATE_MS}ms)=${late.length} ok=${ok.length} done_only=${doneOnly.length}`,
  )
  console.log('')

  if (orphans.length) {
    console.log('--- orphans (proxy_enter, never done) ---')
    for (const r of orphans) printRec('orphan', r)
    console.log('')
  }
  if (late.length) {
    console.log(`--- late (wall gap >= ${LATE_MS}ms; check ssr_elapsed_ms stays small) ---`)
    for (const r of late) printRec('late', r)
    console.log('')
  }
  if (args.ridFilter) {
    console.log('--- ok / done_only (filtered) ---')
    for (const r of ok) printRec('ok', r)
    for (const r of doneOnly) printRec('done_only', r)
  } else if (late.length === 0 && orphans.length === 0) {
    console.log('--- fastest check: top wall gaps among ok ---')
    for (const r of ok.slice(0, 15)) printRec('ok', r)
  } else {
    console.log(`--- ok sample (slowest ${Math.min(10, ok.length)} by wall gap) ---`)
    for (const r of ok.slice(0, 10)) printRec('ok', r)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
