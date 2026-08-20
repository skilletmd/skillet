import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CapabilityAnalysis,
  SecurityFinding,
  SkillCapability,
  SkillCapabilityReport,
} from './types'
import type { KitSkillEntry } from './kits'

// kits-server reads cookies at module load only when its session helpers run;
// stub next/headers so importing the module is safe in jsdom.
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}))

interface BatchScanEntry {
  capabilities: SkillCapabilityReport | null
  findings: SecurityFinding[]
  blindSpots: string[]
}

// The kit roll-up now reads member scans via ONE batch GET (registry U5). Mock
// it so getKitCapabilities can be tested as pure wiring + union + findings
// roll-up. The mock resolves each requested member through a per-member resolver
// and returns the Map the real getScanReportsBatch returns (keyed by
// `author/slug/hash`); a member the resolver returns `undefined` for is OMITTED
// from the Map, mirroring the registry hiding an unreadable member.
const { getScanReportsBatch } = vi.hoisted(() => ({
  getScanReportsBatch: vi.fn<
    (
      members: Array<{ author: string; slug: string; hash: string }>,
    ) => Promise<Map<string, BatchScanEntry>>
  >(),
}))
vi.mock('./registry', () => ({ getScanReportsBatch }))

import { getKitCapabilities } from './kits-server'

function entry(skillId: string, hash: string | null): KitSkillEntry {
  return {
    skill_id: skillId,
    pinned_hash: null,
    current_hash: hash,
    added_at: 0,
  }
}

function cap(
  capability: SkillCapability['capability'],
  risky = false,
  file = 'f.ts',
): SkillCapability {
  return {
    capability,
    risky,
    evidence: [{ file, lineStart: 1, lineEnd: 1, source: 'code' }],
  }
}

/** Wrap member capabilities + findings + blind spots into the batch scan shape. */
function scan(
  capabilities: SkillCapability[] | null,
  analysis: CapabilityAnalysis = 'full',
  findings: SecurityFinding[] = [],
  blindSpots: string[] = [],
): BatchScanEntry {
  return {
    capabilities: capabilities === null ? null : { capabilities, analysis },
    findings,
    blindSpots,
  }
}

/**
 * Configure the batch mock from a per-member resolver: for each requested
 * member the resolver returns a scan (included) or `undefined` (omitted /
 * unreadable → absent from the returned Map).
 */
function mockBatch(
  resolver: (m: { author: string; slug: string; hash: string }) => BatchScanEntry | undefined,
): void {
  getScanReportsBatch.mockImplementation(async (members) => {
    const map = new Map<string, BatchScanEntry>()
    for (const m of members) {
      const s = resolver(m)
      if (s !== undefined) map.set(`${m.author}/${m.slug}/${m.hash}`, s)
    }
    return map
  })
}

beforeEach(() => {
  getScanReportsBatch.mockReset()
})

describe('getKitCapabilities', () => {
  it('unions distinct member capabilities (A shell + B network → both chips)', async () => {
    mockBatch((m) => (m.author === 'a' ? scan([cap('runs-shell')]) : scan([cap('network')])))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['runs-shell', 'network'])
  })

  it('parses author:slug and passes the pinned hash when present, else current', async () => {
    mockBatch(() => scan([]))
    const pinned: KitSkillEntry = {
      skill_id: 'taylor:my-skill',
      pinned_hash: 'PIN',
      current_hash: 'CUR',
      added_at: 0,
    }
    await getKitCapabilities([pinned, entry('b:two', 'CUR2')])
    // One batch call carrying BOTH members with the correct hash each.
    expect(getScanReportsBatch).toHaveBeenCalledTimes(1)
    expect(getScanReportsBatch).toHaveBeenCalledWith([
      { author: 'taylor', slug: 'my-skill', hash: 'PIN' },
      { author: 'b', slug: 'two', hash: 'CUR2' },
    ])
  })

  it('rolls up risky if any member is risky', async () => {
    mockBatch((m) =>
      m.author === 'a' ? scan([cap('deletes-files', false)]) : scan([cap('deletes-files', true)]),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.capabilities).toEqual([
      expect.objectContaining({ capability: 'deletes-files', risky: true }),
    ])
  })

  it('rolls up member findings tagged with their source skill, carrying the flagged snippet', async () => {
    mockBatch((m) =>
      m.author === 'a'
        ? scan([cap('runs-shell')], 'full', [
            {
              category: 'prompt-injection',
              confidence: 'medium',
              file: 'references/codemode.md',
              line: 64,
              why: 'x',
              snippet: 'injection:fake-system-tag',
            },
          ])
        : scan([cap('network')]),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.findings).toEqual([
      expect.objectContaining({
        category: 'prompt-injection',
        snippet: 'injection:fake-system-tag',
        skill: { author: 'a', slug: 'one' },
      }),
    ])
  })

  it('drops informational (low) findings — a member the skill page calls clean never flags the kit', async () => {
    mockBatch((m) =>
      m.author === 'a'
        ? scan([cap('runs-shell')], 'full', [
            {
              category: 'memory-poisoning',
              confidence: 'low',
              file: 'SKILL.md',
              line: 23,
              why: 'x',
            },
          ])
        : scan([cap('network')]),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.findings).toEqual([])
  })

  it('rolls up a finding with a withheld snippet (still tagged with its skill)', async () => {
    mockBatch((m) =>
      m.author === 'a'
        ? scan([cap('runs-shell')], 'full', [
            { category: 'reads-secrets', confidence: 'high', file: '.env', line: 1, why: 'x' },
          ])
        : scan([cap('network')]),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    const finding = union!.findings![0]
    expect(finding).toMatchObject({ category: 'reads-secrets', skill: { author: 'a', slug: 'one' } })
    expect(finding.snippet).toBeUndefined()
  })

  it('does not double-count a duplicated member (same capability + evidence)', async () => {
    mockBatch(() => scan([cap('runs-shell', true, 'scripts/run.sh')]))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('a:one', 'h1')])
    expect(union?.capabilities).toHaveLength(1)
    expect(union!.capabilities[0].evidence).toHaveLength(1)
  })

  it('returns [] (computed, inert) when all members are inert → "No capabilities detected"', async () => {
    mockBatch(() => scan([]))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union).toEqual({
      capabilities: [],
      analysis: 'full',
      findings: [],
      blindSpots: [],
      unscannedSkills: [],
      unavailableSkills: [],
    })
  })

  it('rolls up member unscanned files tagged with their source skill', async () => {
    mockBatch((m) =>
      m.author === 'a'
        ? scan([cap('runs-shell')], 'partial', [], ['setup.rb', 'lib/x.go'])
        : scan([cap('network')], 'partial', [], ['vendor/y.rb']),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.blindSpots).toEqual([
      { file: 'setup.rb', skill: { author: 'a', slug: 'one' } },
      { file: 'lib/x.go', skill: { author: 'a', slug: 'one' } },
      { file: 'vendor/y.rb', skill: { author: 'b', slug: 'two' } },
    ])
  })

  it('dedupes a blind-spot path repeated by a duplicated member', async () => {
    mockBatch(() => scan([cap('runs-shell')], 'partial', [], ['setup.rb']))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('a:one', 'h1')])
    expect(union?.blindSpots).toEqual([{ file: 'setup.rb', skill: { author: 'a', slug: 'one' } }])
  })

  it('returns null when NO member has a computed report (all null)', async () => {
    mockBatch(() => scan(null))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union).toBeNull()
  })

  it('rolls the kit to partial when a member was never computed (null)', async () => {
    mockBatch((m) => (m.author === 'a' ? scan([cap('runs-shell')], 'full') : scan(null)))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    // The computed member still contributes its chip, but the kit is honest that
    // an un-analyzed member means the manifest may be incomplete.
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['runs-shell'])
    expect(union?.analysis).toBe('partial')
  })

  it('rolls the kit to partial when a computed member is itself partial', async () => {
    mockBatch((m) =>
      m.author === 'a' ? scan([cap('runs-shell')], 'full') : scan([cap('network')], 'partial'),
    )
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.analysis).toBe('partial')
  })

  it('rolls an omitted (unreadable) member to partial without mis-attribution', async () => {
    // 'b' is unreadable → the registry omits it → absent from the batch Map.
    mockBatch((m) => (m.author === 'a' ? scan([cap('runs-shell')], 'full') : undefined))
    const union = await getKitCapabilities([entry('a:one', 'h1'), entry('b:two', 'h2')])
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['runs-shell'])
    expect(union?.analysis).toBe('partial')
  })

  it('skips members with no resolvable hash — batch is called only with resolvable members', async () => {
    mockBatch(() => scan([cap('network')]))
    const union = await getKitCapabilities([entry('a:one', null), entry('b:two', 'h2')])
    expect(getScanReportsBatch).toHaveBeenCalledTimes(1)
    expect(getScanReportsBatch).toHaveBeenCalledWith([{ author: 'b', slug: 'two', hash: 'h2' }])
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['network'])
    // A skipped (unresolvable) member counts as not-computed → partial.
    expect(union?.analysis).toBe('partial')
  })

  it('returns null for an empty kit without a batch call', async () => {
    const union = await getKitCapabilities([])
    expect(getScanReportsBatch).not.toHaveBeenCalled()
    expect(union).toBeNull()
  })

  it('issues exactly ONE batch request for a many-member kit (no per-member fan-out)', async () => {
    mockBatch(() => scan([cap('network')]))
    const members = Array.from({ length: 12 }, (_, i) => entry(`a:s${i}`, `h${i}`))
    await getKitCapabilities(members)
    expect(getScanReportsBatch).toHaveBeenCalledTimes(1)
    const passed = getScanReportsBatch.mock.calls[0][0]
    expect(passed).toHaveLength(12)
  })
})
