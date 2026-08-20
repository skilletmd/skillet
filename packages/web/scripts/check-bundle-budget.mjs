#!/usr/bin/env node
/**
 * Rough homepage first-load JS budget check (uncompressed sum of layout + page chunks).
 * Full analyzer integration lands in U8; this script gives a fast local signal after U6.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NEXT_DIR = join(process.cwd(), '.next')
const BUDGET_KB = 250

function chunkBytes(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return 0
  return readdirSync(dir).reduce((sum, file) => {
    if (!file.endsWith('.js')) return sum
    return sum + statSync(join(dir, file)).size
  }, 0)
}

const appDir = join(NEXT_DIR, 'static', 'chunks', 'app')
const layout = chunkBytes(join(appDir, 'layout'))
const home = chunkBytes(join(appDir, '(consumer)', 'page'))
const totalKb = Math.round((layout + home) / 1024)

if (totalKb > BUDGET_KB) {
  console.error(`Homepage first-load JS ~${totalKb}KB exceeds ${BUDGET_KB}KB budget`)
  process.exit(1)
}

console.log(`Homepage first-load JS ~${totalKb}KB (budget ${BUDGET_KB}KB)`)
