import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const commandsDir = join(__dirname, '../src/commands')

const deviceCopyFiles = ['sync.ts', 'connect.ts', 'list.ts', 'status.ts'].map((name) =>
  readFileSync(join(commandsDir, name), 'utf8'),
)

test('scan stays canonical for safety reports; status registered but hidden', () => {
  const scanSrc = deviceCopyFiles[3]
  assert.match(scanSrc, /\.command\("scan"\)/)
  // `doctor` is the visible human diagnostic now; `status` is hidden from help
  // but still registered and byte-compatible with scan (scripts/fall-through).
  assert.match(scanSrc, /\.command\("status", \{ hidden: true \}\)/)
  assert.match(scanSrc, /runScanReport\(opts\)/)
})

test('device command copy does not nudge auth login as peer to connect', () => {
  const dualPath = /connect.*auth login|auth login.*connect/i
  for (const src of deviceCopyFiles) {
    assert.doesNotMatch(src, dualPath)
  }
})

test('connect command references devices settings URL', () => {
  const connectSrc = deviceCopyFiles[1]
  assert.match(connectSrc, /\/settings/)
})

test('no device command file in golden-route set was missed', () => {
  const names = readdirSync(commandsDir).filter((f) => f.endsWith('.ts'))
  assert.ok(names.includes('sync.ts'))
  assert.ok(names.includes('connect.ts'))
})
