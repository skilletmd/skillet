import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Hard ban on custom Tailwind font sizes. Sizes must come from the named scale
// (text-xs…text-3xl) or the sanctioned display classes (.text-title /
// .text-display in globals.css). An arbitrary `text-[Npx]` / `text-[clamp(…)]`
// in markup fails here. Arbitrary COLORS (text-[var(--x)], text-[#hex]) are not
// font sizes and stay allowed — the value starts with a letter/# rather than a
// number or a math function, so the pattern below skips them.
const FONT_SIZE_ARBITRARY = /text-\[(?:length:)?\s*(?:clamp\(|calc\(|min\(|max\(|-?\.?\d)/

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
    ) {
      out.push(full)
    }
  }
  return out
}

describe('no custom font sizes', () => {
  it('uses the named type scale, never arbitrary text-[size]', () => {
    const violations: string[] = []
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FONT_SIZE_ARBITRARY.test(line)) {
            violations.push(`${relative(SRC, file)}:${i + 1}`)
          }
        })
    }
    expect(violations, `Use the type scale or .text-title/.text-display:\n${violations.join('\n')}`).toEqual([])
  })
})
