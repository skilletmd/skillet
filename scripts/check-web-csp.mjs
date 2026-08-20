#!/usr/bin/env node
/**
 * Smoke-check live web CSP: document responses carry the expected mode header.
 *
 * Usage:
 *   node scripts/check-web-csp.mjs
 *   SITE_URL=https://skillet.md WEB_CSP_MODE=enforce node scripts/check-web-csp.mjs
 *
 * WEB_CSP_MODE: enforce (default) | report-only | off
 */
const site = (process.env.SITE_URL ?? 'https://skillet.md').replace(/\/+$/, '')
const expectedMode = process.env.WEB_CSP_MODE ?? 'enforce'

const PATHS = ['/', '/feed/foryou']

async function main() {
  console.log(`Checking CSP at ${site} (expected mode: ${expectedMode})`)

  for (const path of PATHS) {
    await checkPath(path)
  }

  console.log('Web CSP check passed.')
}

async function checkPath(path) {
  console.log(`\n${path}`)

  let res
  try {
    res = await fetch(`${site}${path}`, { redirect: 'follow' })
  } catch (cause) {
    throw new Error(`fetch ${path} failed: ${cause instanceof Error ? cause.message : cause}`)
  }

  if (!res.ok && res.status !== 304) {
    throw new Error(`GET ${path} returned ${res.status}`)
  }

  const enforce = res.headers.get('content-security-policy')
  const reportOnly = res.headers.get('content-security-policy-report-only')
  const frameOptions = res.headers.get('x-frame-options')

  if (expectedMode === 'off') {
    if (enforce || reportOnly) {
      throw new Error(`expected no CSP header in off mode; got enforce=${Boolean(enforce)} report-only=${Boolean(reportOnly)}`)
    }
    console.log('  CSP header absent (off mode) OK')
  } else if (expectedMode === 'enforce') {
    if (!enforce) {
      throw new Error(
        `missing Content-Security-Policy header${reportOnly ? ' (still report-only — run pm2 reload web?)' : ''}`,
      )
    }
    if (reportOnly) {
      throw new Error('both enforce and report-only CSP headers present')
    }
    console.log('  Content-Security-Policy present OK')
    assertCompanion(frameOptions)
    assertPolicyShape(enforce)
  } else if (expectedMode === 'report-only') {
    if (!reportOnly) {
      throw new Error('missing Content-Security-Policy-Report-Only header')
    }
    if (enforce) {
      throw new Error('both enforce and report-only CSP headers present')
    }
    console.log('  Content-Security-Policy-Report-Only present OK')
    assertCompanion(frameOptions)
    assertPolicyShape(reportOnly)
  } else {
    throw new Error(`unknown WEB_CSP_MODE: ${expectedMode}`)
  }
}

function assertCompanion(frameOptions) {
  if (frameOptions !== 'DENY') {
    throw new Error(`expected X-Frame-Options: DENY, got ${frameOptions ?? '(missing)'}`)
  }
  console.log('  X-Frame-Options: DENY OK')
}

function assertPolicyShape(value) {
  for (const fragment of ['default-src', 'script-src', 'frame-ancestors', 'object-src']) {
    if (!value.includes(fragment)) {
      throw new Error(`CSP missing ${fragment}`)
    }
  }
  if (!value.includes('https://static.cloudflareinsights.com')) {
    throw new Error('CSP script-src missing https://static.cloudflareinsights.com')
  }
  console.log('  policy shape OK')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
