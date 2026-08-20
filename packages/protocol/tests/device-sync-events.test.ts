import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeviceSyncStreamEvent } from '../src/device-sync-events.js'

describe('protocol/device-sync-events', () => {
  it('parses sync_required payloads', () => {
    const event = parseDeviceSyncStreamEvent(JSON.stringify({ type: 'sync_required', seq: 9 }))
    assert.deepEqual(event, { type: 'sync_required', seq: 9 })
  })

  it('rejects malformed payloads', () => {
    assert.equal(parseDeviceSyncStreamEvent('not-json'), null)
    assert.equal(parseDeviceSyncStreamEvent(JSON.stringify({ type: 'sync_required' })), null)
    assert.equal(parseDeviceSyncStreamEvent(JSON.stringify({ type: 'sync_required', seq: '9' })), null)
    assert.equal(parseDeviceSyncStreamEvent(JSON.stringify({ type: 'sync_required', seq: Number.NaN })), null)
    assert.equal(parseDeviceSyncStreamEvent(JSON.stringify({ type: 'other', seq: 1 })), null)
  })
})
