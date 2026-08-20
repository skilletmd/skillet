import { describe, it, expect } from 'vitest'
import { mapNotificationEvents } from '@/lib/registry-notifications'

describe('mapNotificationEvents', () => {
  it('maps a followed_you row', () => {
    const [e] = mapNotificationEvents([
      { kind: 'followed_you', actor: 'bob', actor_avatar: '/b.png', at: 100 },
    ])
    expect(e).toEqual({ kind: 'followed_you', actor: 'bob', actorAvatarUrl: '/b.png', at: 100 })
  })

  it('maps a subscribed_kit row with the kit payload (snake → camel)', () => {
    const [e] = mapNotificationEvents([
      {
        kind: 'subscribed_kit',
        actor: 'bob',
        actor_avatar: null,
        at: 200,
        kit: {
          kit_id: 'k1',
          name: 'Ship Review',
          owner: 'grace',
          href: '/kits/k1',
          skill_count: 4,
          description: 'review',
        },
      },
    ])
    expect(e).toMatchObject({
      kind: 'subscribed_kit',
      actor: 'bob',
      actorAvatarUrl: null,
      kit: { kitId: 'k1', name: 'Ship Review', owner: 'grace', skillCount: 4, description: 'review' },
    })
  })

  it('maps a subscribed_author row', () => {
    const [e] = mapNotificationEvents([{ kind: 'subscribed_author', actor: 'bob', at: 300 }])
    expect(e).toMatchObject({ kind: 'subscribed_author', actor: 'bob', actorAvatarUrl: null, at: 300 })
  })

  it('maps a version_blocked system row (no actor) with the skill payload', () => {
    const [e] = mapNotificationEvents([
      {
        kind: 'version_blocked',
        at: 400,
        reason: 'quarantined',
        skill: { skill_id: 'alice:tool', slug: 'tool', author: 'alice', category: 'ai', href: '/alice/tool' },
      },
    ])
    expect(e).toEqual({
      kind: 'version_blocked',
      at: 400,
      reason: 'quarantined',
      skill: { skillId: 'alice:tool', slug: 'tool', author: 'alice', category: 'ai', href: '/alice/tool' },
    })
  })

  it('maps an org_invited system row with the accept payload (snake → camel)', () => {
    const [e] = mapNotificationEvents([
      {
        kind: 'org_invited',
        at: 500,
        invite_id: 'inv-1',
        role: 'admin',
        org: { slug: 'acme', name: 'Acme Corp' },
        inviter: 'taylor',
      },
    ])
    expect(e).toEqual({
      kind: 'org_invited',
      at: 500,
      inviteId: 'inv-1',
      role: 'admin',
      org: { slug: 'acme', name: 'Acme Corp' },
      inviter: 'taylor',
    })
  })

  it('defaults missing fields safely and drops unknown kinds', () => {
    expect(mapNotificationEvents(undefined)).toEqual([])
    expect(mapNotificationEvents([{ kind: 'mystery', actor: 'x', at: 1 }])).toEqual([])
    // subscribed_kit without a kit payload is dropped (not rendered as a broken card)
    expect(mapNotificationEvents([{ kind: 'subscribed_kit', actor: 'x', at: 1 }])).toEqual([])
    // org_invited without invite_id / org is dropped (can't build an accept link)
    expect(mapNotificationEvents([{ kind: 'org_invited', at: 1 }])).toEqual([])
  })
})
