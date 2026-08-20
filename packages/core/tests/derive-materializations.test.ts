import { describe, it, expect } from 'vitest'
import {
  capMaterializations,
  deriveMaterializations,
  MAX_REPORT_MATERIALIZATIONS,
  type MaterializationSource,
  type SkillRuntimeMaterialization,
} from '../src/commands/report-device-agents.js'

function adapter(
  name: string,
  status: 'materialized' | 'skipped-not-detected' | 'failed',
  paths: string[] = [],
) {
  return { name, status, paths }
}

describe('deriveMaterializations', () => {
  it('reports materialized per detected runtime that wrote the skill', () => {
    const src: MaterializationSource = {
      materialized: [
        { slug: '@you/refund', dest: '/cc/refund' },
        { slug: '@you/refund', dest: '/cursor/refund' },
      ],
      adapters: [
        adapter('claude-code', 'materialized', ['/cc/refund']),
        adapter('cursor', 'materialized', ['/cursor/refund']),
      ],
      failed: [],
    }
    const rows = deriveMaterializations(src)
    expect(rows).toContainEqual({ skill_slug: '@you/refund', runtime: 'claude-code', status: 'materialized' })
    expect(rows).toContainEqual({ skill_slug: '@you/refund', runtime: 'cursor', status: 'materialized' })
  })

  it('reports skipped-not-detected (not empty) for a detected runtime that did not write the skill', () => {
    // codex is installed/detected but the skill was not routed there.
    const src: MaterializationSource = {
      materialized: [{ slug: '@you/refund', dest: '/cc/refund' }],
      adapters: [
        adapter('claude-code', 'materialized', ['/cc/refund']),
        adapter('codex', 'materialized', []),
      ],
      failed: [],
    }
    const rows = deriveMaterializations(src)
    // The reveal must never spin: codex gets an explicit honest row.
    expect(rows).toContainEqual({ skill_slug: '@you/refund', runtime: 'codex', status: 'skipped-not-detected' })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('reports failed (not "not installed") when an installed adapter failed mid-materialize', () => {
    const src: MaterializationSource = {
      materialized: [{ slug: '@you/refund', dest: '/cc/refund' }],
      adapters: [
        adapter('claude-code', 'materialized', ['/cc/refund']),
        adapter('cursor', 'failed', []), // detected, but the write threw
      ],
      failed: [],
    }
    const rows = deriveMaterializations(src)
    expect(rows).toContainEqual({ skill_slug: '@you/refund', runtime: 'cursor', status: 'failed' })
  })

  it('reports failed across detected runtimes for an integrity-failed skill', () => {
    const src: MaterializationSource = {
      materialized: [],
      adapters: [adapter('claude-code', 'materialized', []), adapter('cursor', 'materialized', [])],
      failed: [{ slug: '@you/sketchy' }],
    }
    const rows = deriveMaterializations(src)
    expect(rows).toContainEqual({ skill_slug: '@you/sketchy', runtime: 'claude-code', status: 'failed' })
    expect(rows).toContainEqual({ skill_slug: '@you/sketchy', runtime: 'cursor', status: 'failed' })
  })

  it('produces no rows for undetected runtimes', () => {
    const src: MaterializationSource = {
      materialized: [{ slug: '@you/refund', dest: '/cc/refund' }],
      adapters: [
        adapter('claude-code', 'materialized', ['/cc/refund']),
        adapter('windsurf', 'skipped-not-detected', []),
      ],
      failed: [],
    }
    const rows = deriveMaterializations(src)
    expect(rows.some((r) => r.runtime === 'windsurf')).toBe(false)
  })

  it('returns [] for an empty sync', () => {
    expect(deriveMaterializations({ materialized: [], adapters: [], failed: [] })).toEqual([])
  })

  // The registry caps reports at 256 rows; older registries 400 anything larger,
  // and that 400 also killed the edited reconcile riding the same request (the
  // large-kit edit-flag wedge). The client cap keeps the report deliverable
  // everywhere and keeps the informative rows when it trims.
  it('caps an oversized report, keeping failures over successes over noise', () => {
    const rows: SkillRuntimeMaterialization[] = [
      ...Array.from({ length: 300 }, (_, n): SkillRuntimeMaterialization => ({
        skill_slug: `a:noise-${n}`,
        runtime: 'cursor',
        status: 'skipped-not-detected',
      })),
      ...Array.from({ length: 200 }, (_, n): SkillRuntimeMaterialization => ({
        skill_slug: `a:ok-${n}`,
        runtime: 'cursor',
        status: 'materialized',
      })),
      { skill_slug: 'a:broken', runtime: 'cursor', status: 'failed' },
    ]
    const capped = capMaterializations(rows)
    expect(capped).toHaveLength(MAX_REPORT_MATERIALIZATIONS)
    expect(capped[0]).toMatchObject({ skill_slug: 'a:broken', status: 'failed' })
    expect(capped.filter((r) => r.status === 'materialized')).toHaveLength(200)
    expect(capped.filter((r) => r.status === 'skipped-not-detected')).toHaveLength(55)
  })

  it('leaves reports under the cap untouched and in order', () => {
    const rows: SkillRuntimeMaterialization[] = [
      { skill_slug: 'a:x', runtime: 'cursor', status: 'skipped-not-detected' },
      { skill_slug: 'a:y', runtime: 'cursor', status: 'failed' },
    ]
    expect(capMaterializations(rows)).toEqual(rows)
  })
})
