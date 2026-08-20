// U4 — edited skills are held out of bulk-approve and surface in the dedicated
// "Skills you've edited" section of /me/updates (AE2, AE4). The edit flag rides
// device_skill_edits (U2), reported via PUT .../materializations { edited }.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  type Handle,
  type DevSession,
  freshServer,
  mint,
  claim,
  addSkillVersion,
  subscribeAuthor,
  authOf,
} from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled } from './mysql-test-env.js'

// Live MySQL suites opt in via SKILLET_MYSQL_TESTS=1 (`pnpm test:mysql`), the
// same gate every other MySQL suite here uses. Without it this file connected
// unconditionally, so the default `pnpm test` needed a running database despite
// the package README promising a hermetic run.
const hasMysql = mysqlTestsEnabled()

/** Mint a device for a session and return its id + token. */
async function deviceFor(
  h: Handle,
  s: DevSession,
  label: string,
): Promise<{ deviceId: string; deviceToken: string }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/devices/token',
    headers: authOf(s),
    payload: { label },
  })
  assert.equal(res.statusCode, 201, res.body)
  const { device_id, device_token } = res.json() as { device_id: string; device_token: string }
  return { deviceId: device_id, deviceToken: device_token }
}

/** Post-sync report: the device declares which skills it currently has edited. */
function reportEdited(
  h: Handle,
  deviceId: string,
  deviceToken: string,
  edited: Array<{ ref: string; baselineHash: string; baselineVersion?: string }>,
) {
  return h.app.inject({
    method: 'PUT',
    url: `/api/v1/devices/${deviceId}/materializations`,
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: { materializations: [], edited },
  })
}

const updatesOf = async (h: Handle, s: DevSession) =>
  (
    await h.app.inject({ method: 'GET', url: '/api/v1/me/updates', headers: authOf(s) })
  ).json() as {
    pending: Array<{ skill_id: string; to_hash: string }>
    editedSkills: Array<{
      skill_id: string
      to_hash: string
      to_version: number
      to_version_label: string | null
      from_version_label: string | null
      has_upstream: boolean
      devices: Array<{ label: string | null; last_seen_at: number | null }>
    }>
  }

describe('U4 — edited skills held out of bulk-approve + edited section', { skip: !hasMysql }, () => {
  let h: Handle
  let sam: DevSession
  before(async () => {
    h = await freshServer()
    const olivia = await mint(h)
    await claim(h, olivia, 'olivia', 0x61)
    await addSkillVersion(h, 'olivia', 'tool', 'sha256:v1', 1000)

    sam = await mint(h)
    await claim(h, sam, 'sam', 0x63)
    await subscribeAuthor(h, sam.user_id, 'olivia')
  })
  after(async () => {
    await h.app.close()
  })

  it('an edited skill at its current version is an edit-only card; a newer version turns on the upgrade (AE2, AE6)', async () => {
    // Baseline: v1 is a normal pending update before any edit.
    const before = await updatesOf(h, sam)
    assert.equal(before.pending.length, 1)
    assert.equal(before.pending[0].skill_id, 'olivia:tool')
    assert.equal(before.editedSkills.length, 0)

    // Sam edits the skill on the laptop and syncs — baseline == current (v1), so
    // there is no upstream update: it drops out of pending and surfaces as an
    // EDIT-ONLY card (has_upstream: false), no Upgrade offered.
    const laptop = await deviceFor(h, sam, 'Laptop')
    // The device reports its real wire ref `@owner/slug`; the registry must resolve
    // it to the canonical `owner:slug` skill_id before storing, or the pendingTargets
    // exclusion + edited section below never match (the P0 this test guards).
    const rep = await reportEdited(h, laptop.deviceId, laptop.deviceToken, [
      { ref: '@olivia/tool', baselineHash: 'sha256:v1', baselineVersion: '1.0.0' },
    ])
    assert.equal(rep.statusCode, 200, rep.body)
    // (a) stored as the resolved colon-form id, not the `@owner/slug` wire ref.
    const prisma = createTestPrismaClient()
    try {
      const stored = await prisma.device_skill_edits.findFirst({
        where: { device_id: laptop.deviceId },
        select: { skill_id: true },
      })
      assert.equal(stored?.skill_id, 'olivia:tool')
    } finally {
      await prisma.$disconnect()
    }

    const held = await updatesOf(h, sam)
    assert.equal(held.pending.length, 0, 'edited skill is held out of the pending/bulk list (R5)')
    assert.equal(held.editedSkills.length, 1, 'edit-only card surfaces even with no upstream (AE6)')
    assert.equal(held.editedSkills[0].skill_id, 'olivia:tool')
    assert.equal(held.editedSkills[0].has_upstream, false, 'no upstream update → no Upgrade')

    // The bell count reflects the empty pending list too.
    const count = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications/unread-count',
      headers: authOf(sam),
    })
    assert.equal(count.json().pending_updates_count, 0)

    // Olivia ships v2 → the author's update is now waiting. It appears ONLY in the
    // edited section (AE2), never in pending, and carries the device name.
    await addSkillVersion(h, 'olivia', 'tool', 'sha256:v2', 2000, { major: 2, minor: 0, patch: 0 })
    const afterBump = await updatesOf(h, sam)
    assert.equal(afterBump.pending.length, 0, 'a newer version of an edited skill is NOT swept into pending')
    assert.equal(afterBump.editedSkills.length, 1)
    const card = afterBump.editedSkills[0]
    assert.equal(card.skill_id, 'olivia:tool')
    assert.equal(card.to_hash, 'sha256:v2')
    assert.equal(card.to_version, 2)
    assert.equal(card.to_version_label, '2.0.0')
    assert.equal(card.from_version_label, '1.0.0')
    assert.equal(card.has_upstream, true, 'a newer version turns the Upgrade on')
    assert.deepEqual(
      card.devices.map((d) => d.label),
      ['Laptop'],
    )
  })

  it('approve-all leaves the edited skill untouched (no decision written)', async () => {
    const all = await h.app.inject({
      method: 'POST',
      url: '/api/v1/approvals/all',
      headers: authOf(sam),
    })
    // Nothing to approve — the only candidate is held in the edited section.
    assert.equal(all.json().approved, 0)
    const prisma = createTestPrismaClient()
    try {
      const decided = await prisma.update_decisions.count({
        where: { user_id: sam.user_id, skill_id: 'olivia:tool' },
      })
      assert.equal(decided, 0, 'decideAll never decides an edited skill')
    } finally {
      await prisma.$disconnect()
    }

    // Still held in the edited section after the bulk action.
    const after = await updatesOf(h, sam)
    assert.equal(after.editedSkills.length, 1)
    assert.equal(after.pending.length, 0)
  })

  it('Upgrade writes a normal decision via the existing consent rail', async () => {
    const upgrade = await h.app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      payload: { skill_id: 'olivia:tool', version_hash: 'sha256:v2' },
      headers: authOf(sam),
    })
    assert.equal(upgrade.statusCode, 200, upgrade.body)
    const prisma = createTestPrismaClient()
    try {
      const row = await prisma.update_decisions.findFirst({
        where: {
          user_id: sam.user_id,
          skill_id: 'olivia:tool',
          version_hash: 'sha256:v2',
        },
        select: { state: true, source: true },
      })
      assert.equal(row?.state, 'approved')
      assert.equal(row?.source, 'web')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('AE4: edited on device A only — the card names A, and a clean device B never gets its own held row', async () => {
    const olivia = 'olivia'
    // Fresh subscriber so this scenario is isolated from the shared sam fixture.
    const ann = await mint(h)
    await claim(h, ann, 'ann', 0x71)
    await subscribeAuthor(h, ann.user_id, olivia)
    await addSkillVersion(h, olivia, 'widget', 'sha256:w1', 3000)

    const a = await deviceFor(h, ann, 'A-Laptop')
    const b = await deviceFor(h, ann, 'B-Desktop')
    // A edits widget; B reports clean (no edited set).
    assert.equal(
      (
        await reportEdited(h, a.deviceId, a.deviceToken, [
          { ref: `@${olivia}/widget`, baselineHash: 'sha256:w1', baselineVersion: '1.0.0' },
        ])
      ).statusCode,
      200,
    )
    assert.equal((await reportEdited(h, b.deviceId, b.deviceToken, [])).statusCode, 200)

    // Author ships w2 → held for A. Because the flag is device-A-scoped, the card
    // lists ONLY A; B is not in a held row (device B updates normally on its own
    // next sync — the single Upgrade decision drives both machines, take-theirs on
    // A and a plain materialize on B).
    await addSkillVersion(h, olivia, 'widget', 'sha256:w2', 4000, { major: 1, minor: 1, patch: 0 })
    const upd = await updatesOf(h, ann)
    assert.ok(
      !upd.pending.some((p) => p.skill_id === `${olivia}:widget`),
      'edited widget is held out of pending',
    )
    const card = upd.editedSkills.find((c) => c.skill_id === `${olivia}:widget`)
    assert.ok(card, 'widget is in the edited section')
    assert.deepEqual(
      card.devices.map((d) => d.label),
      ['A-Laptop'],
      'only the edited device (A) is named; the clean device (B) is absent',
    )
    // The device's last-sync recency rides the row for display (KTD5, no TTL);
    // it is null until the device reports agent activity, never absent.
    assert.ok('last_seen_at' in card.devices[0])
  })
})
