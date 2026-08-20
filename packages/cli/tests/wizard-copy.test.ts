import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '../src')

const indexSrc = readFileSync(join(srcDir, 'index.ts'), 'utf8')
const syncSrc = readFileSync(join(srcDir, 'commands/sync.ts'), 'utf8')
const helpSrc = readFileSync(join(srcDir, 'help-format.ts'), 'utf8')
const rootSurfaceSrc = readFileSync(join(srcDir, 'help/root-surface.ts'), 'utf8')
const authRequiredSrc = readFileSync(join(srcDir, 'auth-required.ts'), 'utf8')

test('sync and wizard copy do not nudge skillet publish', () => {
  assert.doesNotMatch(syncSrc, /skillet publish/)
  assert.doesNotMatch(indexSrc, /skillet publish/)
  assert.match(syncSrc, /webBaseUrl\(\)/)
})

test('cold start installs the router skill; connecting is opt-in', () => {
  // Unpaired cold start installs the /skillet router skill and points at
  // `skillet connect` — no inline pairing wizard (connecting is deliberate).
  // The no-agents fallback still carries the pair-code guidance.
  assert.match(indexSrc, /installRouterSkill\(/)
  assert.match(indexSrc, /Sign in and get a pair code at/)
  assert.match(indexSrc, /\/settings/)
  assert.doesNotMatch(indexSrc, /Step 1/)
  assert.doesNotMatch(indexSrc, /Step 2/)
  assert.doesNotMatch(indexSrc, /auth login/)
  assert.match(indexSrc, /runConnectedSync\(/)
  assert.match(indexSrc, /discoverExistingSkills/)
  // Cold start no longer runs the interactive pairing prompt.
  assert.doesNotMatch(indexSrc, /pairInteractively/)
  const wizardStart = indexSrc.indexOf('async function runOnboardingWizard')
  const wizardEnd = indexSrc.indexOf('const program = new Command')
  const wizardBody = indexSrc.slice(wizardStart, wizardEnd)
  // The unpaired install precedes the paired sync + optional import.
  const installIdx = wizardBody.indexOf('installRouterSkill')
  const discoveryIdx = wizardBody.indexOf('runDiscovery')
  assert.ok(installIdx >= 0 && discoveryIdx >= 0)
  assert.ok(installIdx < discoveryIdx, 'cold-start install should precede optional import')
})

test('help describes connect-first wizard', () => {
  assert.match(helpSrc, /first run: connect, then sync/)
  assert.doesNotMatch(helpSrc, /import, link account/)
  assert.match(rootSurfaceSrc, /command: 'device'/)
})

test('unpaired guidance lives in the shared auth-required module', () => {
  assert.doesNotMatch(authRequiredSrc, /auth login/)
  assert.match(authRequiredSrc, /\/settings/)
  assert.match(authRequiredSrc, /skillet connect/)
  assert.match(authRequiredSrc, /webBaseUrl\(\)/)
  // The tag the desktop sidecar contract keys on.
  assert.match(authRequiredSrc, /"auth_required"/)
})

test('sync gates on pairing via the shared auth-required failure', () => {
  // Unpaired sync must fail through the one shared module — copy is an import,
  // not a convention — and never fall through to local-only materialization.
  assert.match(syncSrc, /await requirePaired\(opts\.token, \{ json: asJson \}\)/)
  assert.doesNotMatch(syncSrc, /[Aa]nonymous/)
  assert.doesNotMatch(syncSrc, /No skills in kit\. Use `skillet import/)
  assert.doesNotMatch(syncSrc, /auth login/)
})

test('wizard pairs before sync and discovery, and never mints a device', () => {
  const wizardStart = indexSrc.indexOf('async function runOnboardingWizard')
  const wizardEnd = indexSrc.indexOf('const program = new Command')
  const wizardBody = indexSrc.slice(wizardStart, wizardEnd)
  // Pairing check gates the rest of the wizard.
  const gateIdx = wizardBody.indexOf('loadRegistryBearer')
  const syncIdx = wizardBody.indexOf('runConnectedSync(')
  assert.ok(gateIdx >= 0 && syncIdx >= 0)
  assert.ok(gateIdx < syncIdx, 'pairing gate should precede wizard sync')
  // No anonymous identity: nothing in the CLI entry calls /signup or mints devices.
  assert.doesNotMatch(indexSrc, /signup/i)
  assert.doesNotMatch(indexSrc, /ensureAnonymousDevice/)
  assert.doesNotMatch(indexSrc, /[Aa]nonymous/)
})
