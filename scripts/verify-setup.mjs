#!/usr/bin/env node
// Prove the documented setup path works end to end, so onboarding can't silently rot
// (which is how seed:dev broke unnoticed). Runs the README steps against the DATABASE_URL
// in the environment: migrate -> seed -> boot the registry -> assert it serves seeded data.
//
//   Local:  DATABASE_URL=mysql://skillet:skillet@127.0.0.1:3306/skillet_registry \
//             node scripts/verify-setup.mjs
//   CI:     the docs-setup workflow provides DATABASE_URL via a MySQL service container.
//
// Exit 0 = the documented flow works; non-zero = it's broken (fail the build).

import { spawnSync, spawn } from 'node:child_process'
import process from 'node:process'

const PORT = process.env.REGISTRY_PORT || '3481'
const BASE = `http://127.0.0.1:${PORT}`
// A slug + kit we know the demo seed inserts — proves the data actually rendered.
const EXPECT_SKILL = 'k8s-debug'
const EXPECT_KIT = 'Ship Review'

function fail(msg) {
  console.error(`\n[verify-setup] FAIL: ${msg}`)
  process.exit(1)
}

if (!(process.env.DATABASE_URL || '').trim()) {
  fail('DATABASE_URL is not set. Point it at a MySQL you can migrate (see the README Quickstart).')
}

function step(name, cmd, args) {
  console.log(`[verify-setup] ${name}: ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env })
  if (r.status !== 0) fail(`${name} exited ${r.status}`)
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

async function waitForBoot(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/hc`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  fail(`registry did not boot on ${BASE} within ${timeoutMs / 1000}s`)
}

async function main() {
  // 1. Documented setup steps.
  step('migrate', 'pnpm', ['--filter', '@skillet/registry', 'exec', 'prisma', 'migrate', 'deploy'])
  step('seed', 'pnpm', ['--filter', '@skillet/registry', 'seed:dev'])

  // 2. Boot the registry the same way `pnpm dev` does (tsx on src/main.ts).
  const registry = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
    cwd: 'packages/registry',
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  let exited = false
  registry.on('exit', () => {
    exited = true
  })

  try {
    await waitForBoot()
    if (exited) fail('registry process exited during boot')

    // 3. Assert the seeded catalog + kits actually render through the API.
    const feed = await get('/api/v1/discover/feed')
    if (!feed.ok) fail(`GET /api/v1/discover/feed -> ${feed.status}`)
    if (!feed.body.includes(EXPECT_SKILL)) fail(`feed did not include seeded skill "${EXPECT_SKILL}"`)

    const kits = await get('/api/v1/discover/kits')
    if (!kits.ok) fail(`GET /api/v1/discover/kits -> ${kits.status}`)
    if (!kits.body.includes(EXPECT_KIT)) fail(`kits did not include seeded kit "${EXPECT_KIT}"`)

    console.log('\n[verify-setup] PASS: migrate + seed + boot + seeded feed/kits all render.')
  } finally {
    registry.kill('SIGTERM')
  }
  process.exit(0)
}

main().catch((err) => fail(err?.message || String(err)))
