#!/usr/bin/env node
/**
 * Concurrent Browse load check (AE1 anon / AE2 logged-in).
 *
 * Usage:
 *   node scripts/browse-concurrent-load-check.mjs
 *   SKILLET_SESSION_COOKIE='...' CONCURRENCY=100 node scripts/browse-concurrent-load-check.mjs
 *
 * Env:
 *   BASE_URL                 default https://skillet.md
 *   CONCURRENCY              default 100
 *   SKILLET_SESSION_COOKIE   when set, runs AE2 (logged-in primary bar)
 *   TIMEOUT_MS               per-request timeout, default 25000
 */

import { performance } from 'node:perf_hooks'

const BASE = (process.env.BASE_URL ?? 'https://skillet.md').replace(/\/$/, '')
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? '100') || 100)
const TIMEOUT_MS = Math.max(1000, Number(process.env.TIMEOUT_MS ?? '25000') || 25_000)
const COOKIE = process.env.SKILLET_SESSION_COOKIE?.trim() ?? ''

const PATHS = [
  '/browse',
  '/browse/all',
  '/browse/skills',
  '/browse/kits',
  '/browse/people',
  '/browse/frontend',
  '/browse/backend',
  '/browse/creative',
  '/browse/code',
  '/browse/grow',
]

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

async function one(url, headers) {
  const started = performance.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers,
      signal: ac.signal,
      redirect: 'manual',
    })
    const ms = performance.now() - started
    return { status: res.status, ms, url }
  } catch (err) {
    const ms = performance.now() - started
    return {
      status: 0,
      ms,
      url,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`browse-concurrent-load-check — fire CONCURRENCY GETs at Browse URLs

Env:
  BASE_URL                 (${BASE})
  CONCURRENCY              (${CONCURRENCY})
  SKILLET_SESSION_COOKIE   (optional; enables logged-in AE2)
  TIMEOUT_MS               (${TIMEOUT_MS})
`)
    process.exit(0)
  }

  const headers = {
    accept: 'text/html,application/xhtml+xml',
    'user-agent': 'skillet-browse-concurrent-load-check/1.0',
  }
  if (COOKIE) headers.cookie = COOKIE.includes('=') ? COOKIE : `skillet_session=${COOKIE}`

  const mode = COOKIE ? 'logged-in (AE2)' : 'anon (AE1 control)'
  console.log(`mode=${mode} base=${BASE} concurrency=${CONCURRENCY}`)

  const jobs = Array.from({ length: CONCURRENCY }, (_, i) => {
    const path = PATHS[i % PATHS.length]
    return one(`${BASE}${path}`, headers)
  })

  const results = await Promise.all(jobs)
  const statuses = new Map()
  const times = []
  let errors = 0
  for (const r of results) {
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1)
    times.push(r.ms)
    if (r.error || r.status === 0 || r.status >= 500) errors += 1
  }
  times.sort((a, b) => a - b)

  console.log('status counts:', Object.fromEntries(statuses))
  console.log(
    `ttfb ms: p50=${percentile(times, 50).toFixed(0)} p95=${percentile(times, 95).toFixed(0)} max=${times[times.length - 1]?.toFixed(0)}`,
  )
  console.log(`failures (5xx/timeout/error): ${errors}/${results.length}`)

  const s503 = statuses.get(503) ?? 0
  if (s503 > 0 || errors > CONCURRENCY * 0.05) {
    console.error('FAIL: too many errors or any 503')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
