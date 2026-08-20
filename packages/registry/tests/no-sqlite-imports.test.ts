// Gap detection: src/ must not import node:sqlite after the MySQL cutover.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '../src')

// Module imports of node:sqlite (type or value). Comment-only mentions do not match.
const SQLITE_MODULE_IMPORT_RE =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]node:sqlite['"]/

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

function sqliteImportPaths(): string[] {
  const hits: string[] = []
  for (const file of listTsFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8')
    if (SQLITE_MODULE_IMPORT_RE.test(text)) {
      hits.push(relative(srcRoot, file))
    }
  }
  return hits.sort()
}

describe('no sqlite imports in registry src (U5/U6 gap)', () => {
  it('src/ has zero node:sqlite module imports', () => {
    const hits = sqliteImportPaths()
    assert.deepEqual(
      hits,
      [],
      `unexpected node:sqlite imports:\n${hits.join('\n')}`,
    )
  })
})
