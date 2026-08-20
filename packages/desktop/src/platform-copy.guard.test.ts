import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const mainPath = resolve(here, 'main.ts')
const mainSource = readFileSync(mainPath, 'utf8')
const mainLines = mainSource.split('\n')

/** Device nouns belong in platform-copy.ts, never as literals in main.ts. */
const DEVICE_NOUN_LITERALS = ['this Mac', 'Find on this Mac'] as const

/**
 * macOS-only UX copy allowed only in functions that gate on isMacOsDesktop()
 * or render mac-only permission UI (never reached on Windows onboarding).
 */
const MAC_UX_LITERALS = ['Open System Settings', 'macOS will ask'] as const

const MAC_UX_FUNCTIONS = new Set([
  'permissionBannerCopy',
  'renderPasteAnywhereBlock',
  'onboardingPermissionNeededBody',
  'onboardingPermissionFine',
])

function enclosingFunction(lineIndex: number): string | null {
  let current: string | null = null
  for (let i = 0; i <= lineIndex; i++) {
    const fn = mainLines[i].match(/^function (\w+)/)
    if (fn) current = fn[1]
  }
  return current
}

function hasMacGuardAbove(lineIndex: number, lookback = 8): boolean {
  const start = Math.max(0, lineIndex - lookback)
  for (let i = lineIndex; i >= start; i--) {
    if (mainLines[i].includes('isMacOsDesktop()')) return true
  }
  return false
}

function isAllowedMacUxLine(lineIndex: number): boolean {
  const fn = enclosingFunction(lineIndex)
  if (fn !== null && MAC_UX_FUNCTIONS.has(fn)) return true
  if (hasMacGuardAbove(lineIndex)) return true
  const window = mainLines.slice(Math.max(0, lineIndex - 25), lineIndex + 1).join('\n')
  return (
    window.includes('onboardingPermissionNeededBody') ||
    window.includes('renderPasteAnywhereBlock') ||
    window.includes('permissionBannerCopy') ||
    window.includes('permbanner')
  )
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*')
}

describe('main.ts mac-copy guard', () => {
  it('does not hardcode Mac device nouns (use platform-copy helpers)', () => {
    const leaks: string[] = []
    for (let i = 0; i < mainLines.length; i++) {
      const line = mainLines[i]
      if (isCommentLine(line)) continue
      for (const literal of DEVICE_NOUN_LITERALS) {
        if (line.includes(literal)) {
          leaks.push(`L${i + 1}: ${literal}`)
        }
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([])
  })

  it('keeps macOS-only UX strings inside mac-guarded functions', () => {
    const leaks: string[] = []
    for (let i = 0; i < mainLines.length; i++) {
      const line = mainLines[i]
      if (isCommentLine(line)) continue
      for (const literal of MAC_UX_LITERALS) {
        if (!line.includes(literal)) continue
        const fn = enclosingFunction(i)
        if (!isAllowedMacUxLine(i)) {
          leaks.push(`L${i + 1}: ${literal} (fn=${fn ?? 'none'})`)
        }
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([])
  })
})
