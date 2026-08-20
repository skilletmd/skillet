// The materialization report must never take the edited reconcile down with
// it: a big kit's matrix (200 skills × 6 runtimes) legitimately exceeds any
// fixed cap, the client sends the report fire-and-forget, and a 400 here used
// to silently drop the device's edit flags — wedging the web approve flow for
// every large-kit device. Oversized reports clamp; the edit flags always land.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  parseMaterializations,
  MAX_MATERIALIZATIONS,
} from '../src/routes/device-agents.js'
import { addSkillVersionPrisma, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('parseMaterializations clamp', () => {
  const row = (n: number) => ({ skill_slug: `author:skill-${n}`, runtime: 'claude-code', status: 'materialized' })

  it('clamps an oversized report to the cap instead of rejecting it', () => {
    const parsed = parseMaterializations(Array.from({ length: MAX_MATERIALIZATIONS + 900 }, (_, n) => row(n)))
    assert.ok(parsed, 'oversized-but-valid reports must parse')
    assert.equal(parsed.length, MAX_MATERIALIZATIONS)
  })

  it('still rejects non-arrays and malformed items', () => {
    assert.equal(parseMaterializations({}), null)
    assert.equal(parseMaterializations([{ skill_slug: 'x', runtime: 'cursor', status: 'live' }]), null)
  })
})

describe('device materializations report (mysql http)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('an oversized report clamps, reports the drop, and still reconciles edits', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'bigkit', 41)
      await addSkillVersionPrisma(prisma, 'someauthor', 'edited-one', 'sha256:mat-edit-1', 1_700_000_000)

      const minted = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/devices/token',
          headers: { authorization: `Bearer ${session.session_token}` },
          payload: { label: 'big-kit-laptop' },
        })
      ).json() as { device_id: string; device_token: string }

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/devices/${minted.device_id}/materializations`,
        headers: { authorization: `Bearer ${minted.device_token}` },
        payload: {
          materializations: Array.from({ length: MAX_MATERIALIZATIONS + 244 }, (_, n) => ({
            skill_slug: `author:skill-${n}`,
            runtime: 'claude-code',
            status: 'materialized',
          })),
          edited: [
            { skill_id: 'someauthor:edited-one', baseline_version: '1', baseline_hash: 'sha256:mat-edit-1' },
          ],
        },
      })

      assert.equal(res.statusCode, 200, res.payload)
      const body = res.json() as { count: number; dropped?: number; edited: number }
      assert.equal(body.count, MAX_MATERIALIZATIONS)
      assert.equal(body.dropped, 244)
      assert.equal(body.edited, 1)

      // The consent-critical half actually landed.
      const edits = await prisma.device_skill_edits.findMany({ where: { device_id: minted.device_id } })
      assert.equal(edits.length, 1)
      assert.equal(edits[0]!.skill_id, 'someauthor:edited-one')

      const stored = await prisma.device_skill_materializations.count({ where: { device_id: minted.device_id } })
      assert.equal(stored, MAX_MATERIALIZATIONS)
    } finally {
      await prisma.$disconnect()
    }
  })
})
