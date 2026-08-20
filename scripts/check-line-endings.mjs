#!/usr/bin/env node
// Enforce LF line endings on staged text files. Works with .gitattributes (* text eol=lf).
// Scans the index (what will be committed), not just the working tree.
//
// Exemptions: *.bat, *.cmd (Windows launchers), and paths git marks binary.

import { execFileSync } from 'node:child_process'

const CRLF_EXEMPT_SUFFIXES = ['.bat', '.cmd']

function isExempt(path) {
  const lower = path.toLowerCase()
  return CRLF_EXEMPT_SUFFIXES.some((s) => lower.endsWith(s))
}

function isBinary(path) {
  try {
    const out = execFileSync('git', ['check-attr', 'binary', '--', path], {
      encoding: 'utf8',
    }).trim()
    // "path: binary: set" | "path: binary: unset"
    return out.endsWith(': set')
  } catch {
    return false
  }
}

const staged = execFileSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)

if (staged.length === 0) {
  console.log('OK: no staged files to check for line endings.')
  process.exit(0)
}

const violations = []

for (const path of staged) {
  if (isExempt(path) || isBinary(path)) continue

  let buf
  try {
    buf = execFileSync('git', ['show', `:${path}`])
  } catch {
    continue
  }

  if (buf.includes(0)) continue // binary blob in index

  if (buf.includes(0x0d)) {
    const hasCrLf = buf.includes(Buffer.from('\r\n'))
    const kind = hasCrLf ? 'CRLF' : 'CR'
    violations.push({ path, kind })
  }
}

if (violations.length > 0) {
  console.error(
    `Found ${violations.length} staged file(s) with non-LF line endings:\n`,
  )
  for (const v of violations) {
    console.error(`  ${v.path}  (${v.kind})`)
  }
  console.error(
    '\nThis repo stores text as LF (.gitattributes). Re-save as LF or run:',
  )
  console.error('  git add --renormalize <files>')
  console.error('See CONTRIBUTING.md → Line endings.')
  process.exit(1)
}

console.log('OK: staged text files use LF line endings.')
