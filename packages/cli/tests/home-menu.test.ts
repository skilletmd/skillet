// Bare-run home + consent-timing invariants (source-shape, same style as
// wizard-copy.test.ts): the bare command must end at the navigable menu, and
// the stats-sync question must wait until /skillet has actually been used.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '../src')

const indexSrc = readFileSync(join(srcDir, 'index.ts'), 'utf8')
const menuSrc = readFileSync(join(srcDir, 'home-menu.ts'), 'utf8')
const consentSrc = readFileSync(join(srcDir, 'route-hooks-consent.ts'), 'utf8')

test('bare run ends at the home menu, after sync and discovery', () => {
  const wizardStart = indexSrc.indexOf('async function runOnboardingWizard')
  const wizardEnd = indexSrc.indexOf('const program = new Command')
  const wizardBody = indexSrc.slice(wizardStart, wizardEnd)
  const syncIdx = wizardBody.indexOf('runConnectedSync(')
  const menuIdx = wizardBody.indexOf('runHomeMenu()')
  assert.ok(syncIdx >= 0 && menuIdx >= 0)
  assert.ok(syncIdx < menuIdx, 'menu comes after the sync report')
})

test('home menu is TTY-only and earns its options', () => {
  assert.match(menuSrc, /isTTY !== true\) return/)
  // Review only exists when something waits; teaching leads before first use.
  assert.match(menuSrc, /updates\.length > 0/)
  assert.match(menuSrc, /arrivals\.length > 0/)
  assert.match(menuSrc, /How to run your first skill/)
  // Esc leaves quietly (clack cancel handled on every prompt).
  assert.match(menuSrc, /isCancel\(choice\)/)
  assert.match(menuSrc, /isCancel\(action\)/)
})

test('home menu offers Help, rendering the same root --help surface', () => {
  // A bare `skillet` run must be able to reach the full command list.
  assert.match(menuSrc, /value: "help", label: "Help"/)
  assert.match(menuSrc, /if \(choice === "help"\) showHelp\(\)/)
  // Help reuses the single-source root formatter, not a hand-kept copy.
  assert.match(menuSrc, /formatSkilletHelp/)
  assert.match(menuSrc, /registerAllCommands\(program\)/)
})

test('menu approvals materialize immediately — no sync homework', () => {
  const approveIdx = menuSrc.indexOf('approveUpdate(')
  const applyIdx = menuSrc.indexOf('applyToAgents(')
  assert.ok(approveIdx >= 0 && applyIdx >= 0)
  assert.ok(approveIdx < applyIdx)
  // The SUCCESS path assigns no homework. Failure-path recovery hints may
  // name skillet sync — that's guidance after an error, not homework.
  assert.doesNotMatch(menuSrc, /Run `skillet sync` to materialize/i)
  assert.match(menuSrc, /run `skillet sync` to finish applying/)
})

test('quarantined review is informed, default-deny, and per-slug scoped', () => {
  // Findings render before the decision.
  const summaryIdx = menuSrc.indexOf('entry.scanSummary')
  const selectIdx = menuSrc.indexOf('clack.select({\n      message: entry.quarantined')
  assert.ok(summaryIdx >= 0 && selectIdx >= 0 && summaryIdx < selectIdx)
  // Enter-Enter can never approve a quarantined entry.
  assert.match(menuSrc, /initialValue: entry\.quarantined \? "later" : "approve"/)
  // The consent confirm defaults to No and fails closed on Esc.
  assert.match(menuSrc, /isCancel\(consent\) \|\| consent !== true/)
  // Consent is granted per slug, never batch-wide.
  assert.match(menuSrc, /allowQuarantinedSlugs: quarantineConsented/)
  assert.doesNotMatch(menuSrc, /allowQuarantined: true/)
})

test('stats consent waits for real local uses; before that it teaches', () => {
  const usesGate = consentSrc.indexOf('uses === 0')
  const ask = consentSrc.indexOf('clack.confirm')
  assert.ok(usesGate >= 0 && ask >= 0)
  assert.ok(usesGate < ask, 'the zero-use path must return before the ask')
  assert.match(consentSrc, /readRouteHistory/)
  // Esc defers the choice — never a recorded opt-out.
  assert.match(consentSrc, /isCancel\(record\)\) return/)
  // The ask never claims public exposure; stats are private-by-default.
  assert.doesNotMatch(consentSrc, /ranking/)
})
