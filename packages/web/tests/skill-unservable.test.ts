import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const view = readFileSync(
  resolve(process.cwd(), 'src/components/skills/skill-page-view.tsx'),
  'utf8',
)
const history = readFileSync(
  resolve(process.cwd(), 'src/components/skills/version-history.tsx'),
  'utf8',
)

/**
 * A skill whose every version was quarantined by the scanner has no
 * `latest_hash`, so downloads 403. Fifteen such skills shipped publicly with a
 * working "Add skill" button and an `npx skilletmd add` command that could not
 * work. The page only checked `moderationStatus`, which a scanner block never
 * sets — all fifteen read as unmoderated while serving nothing.
 */
describe('a skill with no servable version', () => {
  it('treats a scanner block like a moderator block for install affordances', () => {
    expect(view).toContain('const noServableVersion = skill.hasInstallableVersion === false')
    expect(view).toContain('const blocked = quarantined || noServableVersion')
    // Both install paths — the header action and the panel below the content.
    expect(view).toContain('skill.deprecated || blocked ?')
    expect(view).toContain('{!(skill.deprecated || blocked) && (')
    expect(view).toContain('{!skill.deprecated && !blocked && (')
  })

  it('does not gate install on moderationStatus alone', () => {
    // The original bug: `quarantined` is moderator-only and was the sole gate.
    expect(view).not.toContain('{!(skill.deprecated || quarantined) && (')
    expect(view).not.toContain('{!skill.deprecated && !quarantined && (')
  })

  it('says the scanner held it, and that no moderator was involved', () => {
    expect(view).toContain('Not available to install.')
    expect(view).toContain('Nothing here was reviewed by a moderator.')
  })

  // The banner claimed "You're on the last one that passed" when nothing passed
  // — reassuring the reader about content the scanner had rejected.
  it('never claims a passing version exists when none does', () => {
    expect(history).toContain('noneServable')
    expect(history).toContain('nothing to install here yet')
    // lastIndexOf, not indexOf: the prop's own JSDoc quotes the old copy while
    // explaining why it was wrong, and that mention sits above the JSX.
    const claim = history.lastIndexOf('last one that passed')
    expect(claim).toBeGreaterThan(-1)
    expect(history.slice(0, claim)).toContain('noneServable ? (')
  })
})
