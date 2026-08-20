import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collapseDevicesByMachine } from '../src/device-collapse.js'

describe('collapseDevicesByMachine', () => {
  it('collapses two rows sharing a machine_id into one', () => {
    const rows = [
      {
        device_id: 'desktop-row',
        machine_id: 'machine-a',
        created_at: 100,
        last_seen_at: 200,
        client_kinds: ['cli', 'desktop'],
      },
      {
        device_id: 'cli-row',
        machine_id: 'machine-a',
        created_at: 300,
        last_seen_at: 400,
        client_kinds: ['cli'],
      },
    ]
    const out = collapseDevicesByMachine(rows)
    assert.equal(out.length, 1)
    // Most-recently-seen row survives when no current device is named.
    assert.equal(out[0]!.device_id, 'cli-row')
    // Kinds union across the machine's rows.
    assert.deepEqual([...out[0]!.client_kinds!].sort(), ['cli', 'desktop'])
    // Earliest first-seen, latest last-seen across the machine.
    assert.equal(out[0]!.created_at, 100)
    assert.equal(out[0]!.last_seen_at, 400)
  })

  it('keeps the current device as the survivor even if seen less recently', () => {
    const rows = [
      { device_id: 'warm-sibling', machine_id: 'm', created_at: 1, last_seen_at: 999 },
      { device_id: 'this-machine', machine_id: 'm', created_at: 2, last_seen_at: 10 },
    ]
    const out = collapseDevicesByMachine(rows, 'this-machine')
    assert.equal(out.length, 1)
    assert.equal(out[0]!.device_id, 'this-machine')
  })

  it('never merges rows without a machine_id', () => {
    const rows = [
      { device_id: 'a', machine_id: null, created_at: 1 },
      { device_id: 'b', machine_id: null, created_at: 2 },
      { device_id: 'c', created_at: 3 },
    ]
    const out = collapseDevicesByMachine(rows)
    assert.equal(out.length, 3)
  })

  it('is order-stable by first appearance and preserves singletons untouched', () => {
    const solo = { device_id: 'solo', machine_id: 'm2', created_at: 5, label: 'Keep me' }
    const rows = [
      { device_id: 'x1', machine_id: 'm1', created_at: 1, last_seen_at: 1 },
      solo,
      { device_id: 'x2', machine_id: 'm1', created_at: 2, last_seen_at: 2 },
    ]
    const out = collapseDevicesByMachine(rows as Array<typeof solo & { last_seen_at?: number }>)
    assert.deepEqual(out.map((d) => d.machine_id), ['m1', 'm2'])
    // Singleton returned by identity — extra fields preserved.
    assert.equal(out[1], solo)
  })

  it('falls back to created_at when last_seen_at is absent', () => {
    const rows = [
      { device_id: 'older', machine_id: 'm', created_at: 10 },
      { device_id: 'newer', machine_id: 'm', created_at: 20 },
    ]
    const out = collapseDevicesByMachine(rows)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.device_id, 'newer')
  })
})
