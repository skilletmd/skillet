import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

test('bundled cli.cjs --help uses grouped Skillet format (npm publish path)', () => {
  execFileSync('node', ['scripts/bundle-cli.mjs'], { cwd: pkgRoot, stdio: 'pipe' })
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
