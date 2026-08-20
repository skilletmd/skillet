/**
 * The post-sync device report clears the registry's per-device edit-flags by
 * ABSENCE: every report carries the CURRENT edited set and the registry
 * reconciles its flags to exactly that set. So when a device un-customizes its
 * LAST edited skill in a sync that also materializes nothing, the now-empty
 * edited set MUST still be sent (edited: [] explicitly) — otherwise the stale
 * device_skill_edits row never clears and holds that skill's updates out of
 * bulk-approve forever (P2).
 *
 * The transition FROM having-reported-edits TO none is tracked by the
 * `edited_reported` marker in local state. This exercises:
 *   - transition-to-empty with zero materializations → report FIRES, edited: []
 *   - never-had-edits + nothing materialized → still SKIPS (no redundant report)
 *   - materializations present → reports normally (regression)
 *   - the marker is persisted true after edits ride a report, cleared after the
 *     now-empty set reaches the registry, and NOT flipped when the send fails.
 *
 * Isolation: SKILLET_DIR redirected via vi.hoisted BEFORE @skillet/core loads,
 * so store.ts's frozen STATE_FILE const points at the temp dir.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-report-clearing')
})
void TEST_ROOT

import {
  reportDeviceMaterializations,
  type EditedSkill,
  type SkillRuntimeMaterialization,
} from '../src/commands/report-device-agents.js'
import { readState, writeState } from '../src/kit/store.js'
import { saveDeviceToken } from '../src/device-token.js'
import type { KitState } from '../src/kit/types.js'

const REGISTRY_URL = 'https://registry.example.test'

/** Records each request the RegistryClient makes; returns 200 for the PUT. */
function recordingFetch(status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    return { status } as Response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function baseOpts(
  fetchImpl: typeof fetch,
  over: Partial<Parameters<typeof reportDeviceMaterializations>[0]> = {},
): Parameters<typeof reportDeviceMaterializations>[0] {
  return {
    registryUrl: REGISTRY_URL,
    token: 'skillet_d_test',
    bearerKind: 'device',
    materializations: [],
    edited: [],
    fetchImpl,
    ...over,
  }
}

const editedSkill: EditedSkill = {
  ref: '@you/refund',
  baselineVersion: '2',
  baselineHash: 'sha256:baseline',
}

const oneMaterialization: SkillRuntimeMaterialization = {
  skill_slug: '@you/refund',
  runtime: 'claude',
  status: 'materialized',
}

async function seedState(partial: Partial<KitState>): Promise<void> {
  const state = await readState()
  await writeState({ ...state, ...partial })
}

describe('reportDeviceMaterializations — clear-edits-by-absence transition', () => {
  beforeEach(async () => {
    await saveDeviceToken('skillet_d_test', { device_id: 'dev-1', label: 'laptop' })
    // Reset marker + skills between cases.
    await writeState({ version: 1, skills: {} })
  })

  it('fires the clearing report (edited: []) when the last edited skill un-customizes in a zero-materialization sync', async () => {
    // Last sync reported one edited skill.
    await seedState({ edited_reported: true })
    const { calls, fetchImpl } = recordingFetch()

    // This sync: the skill un-customized (edited empty) AND nothing materialized.
    await reportDeviceMaterializations(baseOpts(fetchImpl, { materializations: [], edited: [] }))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toContain('/devices/dev-1/materializations')
    const body = calls[0]!.body as { materializations: unknown[]; edited: unknown[] }
    // The empty edited set must be PRESENT (not omitted) so the registry
    // reconciles-to-empty rather than skipping.
    expect(body).toHaveProperty('edited')
    expect(body.edited).toEqual([])
    expect(body.materializations).toEqual([])
    // Marker cleared once the empty set reached the registry.
    expect((await readState()).edited_reported).toBeUndefined()
  })

  it('stays silent (no redundant report) when a device that never had edits materializes nothing', async () => {
    // No prior edits reported.
    const { calls, fetchImpl } = recordingFetch()

    await reportDeviceMaterializations(baseOpts(fetchImpl, { materializations: [], edited: [] }))

    expect(calls).toHaveLength(0)
    expect((await readState()).edited_reported).toBeUndefined()
  })

  it('reports normally when there are materializations, carrying an explicit empty edited set', async () => {
    const { calls, fetchImpl } = recordingFetch()

    await reportDeviceMaterializations(
      baseOpts(fetchImpl, { materializations: [oneMaterialization], edited: [] }),
    )

    expect(calls).toHaveLength(1)
    const body = calls[0]!.body as { materializations: unknown[]; edited: unknown[] }
    expect(body.materializations).toEqual([oneMaterialization])
    expect(body.edited).toEqual([])
    // No edits rode this report → the marker stays unset.
    expect((await readState()).edited_reported).toBeUndefined()
  })

  it('sets the marker true when a non-empty edited set rides a report', async () => {
    const { calls, fetchImpl } = recordingFetch()

    await reportDeviceMaterializations(baseOpts(fetchImpl, { materializations: [], edited: [editedSkill] }))

    expect(calls).toHaveLength(1)
    const body = calls[0]!.body as { edited: unknown[] }
    expect(body.edited).toEqual([editedSkill])
    expect((await readState()).edited_reported).toBe(true)
  })

  it('does NOT clear the marker when the clearing send fails — the report retries next sync', async () => {
    await seedState({ edited_reported: true })
    const { calls, fetchImpl } = recordingFetch(500) // registry rejects

    await expect(
      reportDeviceMaterializations(baseOpts(fetchImpl, { materializations: [], edited: [] })),
    ).rejects.toBeTruthy()

    expect(calls).toHaveLength(1) // it DID attempt the send
    // Marker survives the failure so the next sync re-sends the clearing report.
    expect((await readState()).edited_reported).toBe(true)
  })

  it('skips entirely for a kit-key bearer (no device edit-flags to reconcile)', async () => {
    await seedState({ edited_reported: true })
    const { calls, fetchImpl } = recordingFetch()

    await reportDeviceMaterializations(baseOpts(fetchImpl, { bearerKind: 'kit' }))

    expect(calls).toHaveLength(0)
    // Marker untouched — a kit-key sync never owns device edit-flags.
    expect((await readState()).edited_reported).toBe(true)
  })
})
