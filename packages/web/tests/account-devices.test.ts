import { describe, expect, it } from 'vitest'
import { normalizeAccountDevices, syncDevicePendingRuntimeReport } from '@/lib/account-devices'
import type { AccountDeviceRow } from '@/lib/account-devices'
import type { Delegation } from '@/lib/enroll-device'

const activeDelegation = (overrides: Partial<Delegation> = {}): Delegation => ({
  device_key_id: 'a'.repeat(64),
  label: 'Thiago Macbook',
  scopes: ['propose', 'approve'],
  issued_at: 1,
  expires_at: 9999999999,
  revoked_at: null,
  status: 'active',
  ...overrides,
})

describe('normalizeAccountDevices', () => {
  it('returns sync rows only when there are no active delegations', () => {
    const rows = normalizeAccountDevices(
      [{ device_id: 'dev-1', label: 'Laptop', created_at: 100 }],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'sync', device_id: 'dev-1' })
  })

  it('collapses two rows sharing a machine_id into one card', () => {
    const rows = normalizeAccountDevices(
      [
        {
          device_id: 'desktop-row',
          label: 'test-machine',
          created_at: 100,
          last_seen_at: 200,
          client_kinds: ['desktop'],
          machine_id: 'machine-a',
        },
        {
          device_id: 'cli-row',
          label: 'test-machine',
          created_at: 300,
          last_seen_at: 400,
          client_kinds: ['cli'],
          machine_id: 'machine-a',
        },
      ],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'sync', device_id: 'cli-row' })
    expect((rows[0] as { client_kinds?: string[] }).client_kinds?.sort()).toEqual(['cli', 'desktop'])
    // Disconnect is machine-scoped: the card must carry EVERY device id in the
    // group, or revoking deletes only the representative and a zombie twin
    // keeps rendering the machine as connected.
    expect(
      (rows[0] as { machine_device_ids?: string[] }).machine_device_ids?.sort(),
    ).toEqual(['cli-row', 'desktop-row'])
  })

  it('keeps rows without a machine_id separate', () => {
    const rows = normalizeAccountDevices(
      [
        { device_id: 'dev-1', label: 'A', created_at: 1 },
        { device_id: 'dev-2', label: 'B', created_at: 2 },
      ],
      [],
    )
    expect(rows).toHaveLength(2)
  })

  it('includes active legacy delegations', () => {
    const rows = normalizeAccountDevices([], [activeDelegation()])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'legacy-signing',
      device_key_id: 'a'.repeat(64),
    })
  })

  it('omits revoked and expired delegations', () => {
    const rows = normalizeAccountDevices(
      [],
      [
        activeDelegation({ status: 'revoked' }),
        activeDelegation({ device_key_id: 'b'.repeat(64), status: 'expired' }),
      ],
    )
    expect(rows).toHaveLength(0)
  })

  it('passes client_kinds and machine_id through, preserving field absence', () => {
    const rows = normalizeAccountDevices(
      [
        {
          device_id: 'd-new',
          label: 'iMac',
          created_at: 2,
          client_kind: 'desktop',
          client_kinds: ['cli', 'desktop'],
          client_platform: 'macos',
          machine_id: 'f'.repeat(64),
        },
        // Old-registry shape: no client_kinds field at all.
        { device_id: 'd-old', label: 'test-machine', created_at: 1 },
      ],
      [],
    )
    const byId = new Map(rows.map((r) => [r.kind === 'sync' ? r.device_id : '', r]))
    const fresh = byId.get('d-new')
    const legacy = byId.get('d-old')
    if (fresh?.kind !== 'sync' || legacy?.kind !== 'sync') throw new Error('expected sync rows')
    expect(fresh.client_kinds).toEqual(['cli', 'desktop'])
    expect(fresh.machine_id).toBe('f'.repeat(64))
    // Absence survives normalization — it is the old-registry fallback signal.
    expect(legacy.client_kinds).toBeUndefined()
    expect(legacy.machine_id).toBeNull()
  })

  it('merges sync and legacy rows', () => {
    const rows = normalizeAccountDevices(
      [{ device_id: 'dev-1', label: 'Alpha', created_at: 100 }],
      [activeDelegation({ label: 'Beta Mac' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Beta Mac'])
  })
})

describe('syncDevicePendingRuntimeReport', () => {
  const syncRow = (overrides: Partial<AccountDeviceRow & { kind: 'sync' }> = {}) =>
    ({
      kind: 'sync',
      device_id: 'dev-1',
      label: 'Laptop',
      created_at: 100,
      ...overrides,
    }) as AccountDeviceRow

  it('is true when a sync device has no agents_reported_at', () => {
    expect(syncDevicePendingRuntimeReport([syncRow({ agents_reported_at: null })])).toBe(true)
  })

  it('is false when every sync device has reported runtimes', () => {
    expect(syncDevicePendingRuntimeReport([syncRow({ agents_reported_at: 1_700_000_000 })])).toBe(
      false,
    )
  })

  it('ignores legacy signing rows', () => {
    const rows: AccountDeviceRow[] = [
      {
        kind: 'legacy-signing',
        device_key_id: 'a'.repeat(64),
        label: 'Browser',
        scopes: ['propose'],
        expires_at: 9_999_999_999,
      },
    ]
    expect(syncDevicePendingRuntimeReport(rows)).toBe(false)
  })

  it('is false for an empty list', () => {
    expect(syncDevicePendingRuntimeReport([])).toBe(false)
  })

  it('treats agents_reported_at 0 as reported', () => {
    expect(syncDevicePendingRuntimeReport([syncRow({ agents_reported_at: 0 })])).toBe(false)
  })
})
