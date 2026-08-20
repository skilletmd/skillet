import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

// The bundle is built once by the `test` script, before any test file runs.
// Rebuilding it here would rewrite dist/cli.cjs while the sibling test files
// running in parallel are spawning it — a spawn landing in that write window
// gets a truncated bundle and exits non-zero.
test('bundled cli.cjs --help uses grouped Skillet format (npm publish path)', () => {
  const out = execFileSync('node', ['dist/cli.cjs', '--help'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  const text = stripAnsi(out)
  assert.match(text, /Skillet \d+\.\d+\.\d+/)
  assert.match(text, /Getting started/)
  assert.match(text, /Sync & share/)
  assert.doesNotMatch(text, /kit create/)
  assert.doesNotMatch(text, /^Usage: skillet \[options\] \[command\]/m)
})
