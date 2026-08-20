import { describe, it, expect } from 'vitest'
import { unionCapabilities, type KitMemberReport } from './capability-union'
import { CAPABILITY_ORDER } from './types'
import type { CapabilityAnalysis, SkillCapability, SkillCapabilityReport } from './types'

function cap(
  capability: SkillCapability['capability'],
  opts: { risky?: boolean; evidence?: SkillCapability['evidence'] } = {},
): SkillCapability {
  return { capability, risky: opts.risky ?? false, evidence: opts.evidence ?? [] }
}

function report(
  capabilities: SkillCapability[],
  analysis: CapabilityAnalysis = 'full',
): SkillCapabilityReport {
  return { capabilities, analysis }
}

/** Wrap a report (or null/undefined) with a member identity, as the kit page does. */
function mem(
  report: SkillCapabilityReport | null | undefined,
  author = 'auth',
  slug = 'skill',
): KitMemberReport {
  return { author, slug, report }
}

function ev(
  file: string,
  lineStart = 1,
  source: 'code' | 'instructions' = 'code',
): SkillCapability['evidence'][number] {
  return { file, lineStart, lineEnd: lineStart, source }
}

describe('unionCapabilities', () => {
  it('unions distinct member capabilities (A shell + B network → both)', () => {
    const a = mem(report([cap('runs-shell', { evidence: [ev('a/run.sh', 3)] })]), 'ann', 'sh')
    const b = mem(report([cap('network', { evidence: [ev('b/fetch.ts', 7)] })]), 'bob', 'net')
    const union = unionCapabilities([a, b])
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['runs-shell', 'network'])
  })

  it('rolls up risky: risky in ANY member makes the unioned chip risky', () => {
    const a = mem(report([cap('deletes-files', { risky: false, evidence: [ev('a/x.ts', 1)] })]), 'ann', 'x')
    const b = mem(report([cap('deletes-files', { risky: true, evidence: [ev('b/wipe.sh', 9)] })]), 'bob', 'wipe')
    const union = unionCapabilities([a, b])
    expect(union?.capabilities).toHaveLength(1)
    expect(union!.capabilities[0]).toMatchObject({ capability: 'deletes-files', risky: true })
    // Evidence merged across both members.
    expect(union!.capabilities[0].evidence).toHaveLength(2)
  })

  it('dedups evidence so a duplicated/mirrored member is not double-counted', () => {
    const evidence = [ev('scripts/run.sh', 12)]
    const a = mem(report([cap('runs-shell', { risky: true, evidence })]), 'ann', 'one')
    // Same capability + identical evidence (a mirror of the same skill).
    const b = mem(report([cap('runs-shell', { risky: true, evidence: [ev('scripts/run.sh', 12)] })]), 'bob', 'two')
    const union = unionCapabilities([a, b])
    expect(union?.capabilities).toHaveLength(1)
    expect(union!.capabilities[0].evidence).toHaveLength(1)
  })

  it('keeps distinct evidence locations within one capability', () => {
    const a = mem(report([cap('network', { evidence: [ev('a.ts', 1), ev('a.ts', 2)] })]), 'ann', 'one')
    const b = mem(report([cap('network', { evidence: [ev('b.ts', 5)] })]), 'bob', 'two')
    const union = unionCapabilities([a, b])
    expect(union!.capabilities[0].evidence).toHaveLength(3)
  })

  it('treats (file,lineStart,lineEnd,source) as the evidence identity', () => {
    // Same file+line but a different source is a distinct location, not a dup.
    const a = mem(report([cap('runs-shell', { evidence: [ev('SKILL.md', 4, 'code')] })]), 'ann', 'one')
    const b = mem(report([cap('runs-shell', { evidence: [ev('SKILL.md', 4, 'instructions')] })]), 'bob', 'two')
    const union = unionCapabilities([a, b])
    expect(union!.capabilities[0].evidence).toHaveLength(2)
  })

  it('returns [] when every member was computed-but-inert', () => {
    const union = unionCapabilities([mem(report([]), 'ann', 'one'), mem(report([]), 'bob', 'two')])
    expect(union?.capabilities).toEqual([])
  })

  it('returns null when NO member has a computed report (all null/undefined)', () => {
    expect(unionCapabilities([mem(null, 'ann', 'one'), mem(undefined, 'bob', 'two')])).toBeNull()
    expect(unionCapabilities([])).toBeNull()
  })

  it('ignores null members but still unions the computed ones', () => {
    const a = mem(report([cap('runs-shell', { evidence: [ev('a.sh', 1)] })]), 'ann', 'one')
    const union = unionCapabilities([a, mem(null, 'bob', 'two'), mem(undefined, 'cam', 'three')])
    expect(union?.capabilities.map((c) => c.capability)).toEqual(['runs-shell'])
  })

  it('emits chips in a canonical order regardless of member order', () => {
    const a = mem(report([cap('executes-generated')]), 'ann', 'one')
    const b = mem(report([cap('runs-shell')]), 'bob', 'two')
    const c = mem(report([cap('network')]), 'cam', 'three')
    const union = unionCapabilities([a, b, c])
    expect(union?.capabilities.map((x) => x.capability)).toEqual([
      'runs-shell',
      'network',
      'executes-generated',
    ])
  })

  it('renders all 9 capabilities in canonical order from a shuffled input', () => {
    // One member per key, fed in reverse order — the union must re-canonicalize.
    const shuffled = [...CAPABILITY_ORDER].reverse().map((k, i) => mem(report([cap(k)]), `a${i}`, k))
    const union = unionCapabilities(shuffled)
    expect(union?.capabilities.map((c) => c.capability)).toEqual([
      'runs-shell',
      'network',
      'writes-files',
      'deletes-files',
      'reads-secrets',
      'install-hooks',
      'connects-mcp-server',
      'executes-generated',
      'injects-output-content',
    ])
  })

  // --- Per-capability skill attribution (kit "hiding in the crowd") ---

  it('attributes each capability to its contributing member skills (deduped)', () => {
    const a = mem(report([cap('writes-files')]), 'ann', 'writer')
    const b = mem(report([cap('writes-files')]), 'bob', 'scribe')
    const union = unionCapabilities([a, b])
    const writes = union!.capabilities.find((c) => c.capability === 'writes-files')!
    expect(writes.skills).toEqual([
      { author: 'ann', slug: 'writer', risky: false },
      { author: 'bob', slug: 'scribe', risky: false },
    ])
  })

  it('sorts a risky contributor first and marks it risky in that member', () => {
    const safe = mem(report([cap('network', { risky: false })]), 'zoe', 'safe')
    const risky = mem(report([cap('network', { risky: true })]), 'ann', 'sketchy')
    const union = unionCapabilities([safe, risky])
    const net = union!.capabilities.find((c) => c.capability === 'network')!
    expect(net.skills?.map((s) => `${s.slug}:${s.risky}`)).toEqual(['sketchy:true', 'safe:false'])
  })

  it('deduplicates a contributor that lists the capability twice, OR-ing its risk', () => {
    // A single member whose report somehow carries the same capability twice
    // (once risky) collapses to one contributor with risky=true.
    const a = mem(
      report([cap('deletes-files', { risky: false }), cap('deletes-files', { risky: true })]),
      'ann',
      'cleaner',
    )
    const union = unionCapabilities([a])
    const del = union!.capabilities.find((c) => c.capability === 'deletes-files')!
    expect(del.skills).toEqual([{ author: 'ann', slug: 'cleaner', risky: true }])
  })

  it('omits a member with no identity from contributors (malformed kit entry)', () => {
    const named = mem(report([cap('runs-shell')]), 'ann', 'one')
    const anon = mem(report([cap('runs-shell')]), '', '')
    const union = unionCapabilities([named, anon])
    const shell = union!.capabilities.find((c) => c.capability === 'runs-shell')!
    expect(shell.skills).toEqual([{ author: 'ann', slug: 'one', risky: false }])
  })

  // --- Analysis roll-up (FIX C honesty) ---

  it('rolls the kit to partial when ANY member was not computed (null)', () => {
    const a = mem(report([cap('runs-shell')], 'full'), 'ann', 'one')
    const union = unionCapabilities([a, mem(null, 'bob', 'two')])
    expect(union?.analysis).toBe('partial')
  })

  it('rolls the kit to partial when ANY computed member is itself partial', () => {
    const a = mem(report([cap('runs-shell')], 'full'), 'ann', 'one')
    const b = mem(report([cap('network')], 'partial'), 'bob', 'two')
    const union = unionCapabilities([a, b])
    expect(union?.analysis).toBe('partial')
  })

  it('is full only when every member is computed AND full (inert → full + [])', () => {
    const union = unionCapabilities([
      mem(report([], 'full'), 'ann', 'one'),
      mem(report([], 'full'), 'bob', 'two'),
    ])
    expect(union).toEqual({ capabilities: [], analysis: 'full' })
  })
})

describe('CAPABILITY_ORDER (taxonomy drift guard)', () => {
  // CAPABILITY_ORDER is now sourced from `@skillet/protocol` (PERMISSION_ORDER) —
  // the one authoritative chip order. This hardcoded set is the drift guard:
  // reordering or extending the protocol vocabulary without intending to change
  // the web chip order must fail here.
  it('has exactly the 9 canonical keys, in order', () => {
    expect([...CAPABILITY_ORDER]).toEqual([
      'runs-shell',
      'network',
      'writes-files',
      'deletes-files',
      'reads-secrets',
      'install-hooks',
      'connects-mcp-server',
      'executes-generated',
      'injects-output-content',
    ])
  })

  it('has no duplicate keys', () => {
    expect(new Set(CAPABILITY_ORDER).size).toBe(CAPABILITY_ORDER.length)
  })
})
