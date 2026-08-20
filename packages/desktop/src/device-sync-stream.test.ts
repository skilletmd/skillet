import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  clearPersistedDeviceSyncSeq,
  deviceSyncStreamUrl,
  persistDeviceSyncSeq,
  readPersistedDeviceSyncSeq,
  readSseDataMessages,
  shouldTriggerDeviceSync,
} from './device-sync-stream'

describe('device sync stream helpers', () => {
  beforeEach(() => {
    clearPersistedDeviceSyncSeq()
  })

  afterEach(() => {
    clearPersistedDeviceSyncSeq()
  })
  it('builds the device sync stream URL from the registry root', () => {
    expect(
      deviceSyncStreamUrl({
        registryUrl: 'https://registry.skillet.md/',
        deviceToken: 'sk_live_123',
      }),
    ).toBe('https://registry.skillet.md/api/v1/devices/sync/stream')
  })

  it('reads complete SSE data messages and keeps the partial tail', () => {
    const parsed = readSseDataMessages(
      'data: {"type":"sync_required","seq":1}\n\n' +
        'event: ignored\n' +
        'data: {"type":"sync_required","seq":2}\n\n' +
        'data: {"type":"sync_required"',
    )

    expect(parsed.messages).toEqual([
      '{"type":"sync_required","seq":1}',
      '{"type":"sync_required","seq":2}',
    ])
    expect(parsed.rest).toBe('data: {"type":"sync_required"')
  })

  it('uses the first cursor as a baseline and triggers only for newer cursors', () => {
    expect(shouldTriggerDeviceSync(null, { type: 'sync_required', seq: 1 })).toBe(false)
    expect(shouldTriggerDeviceSync(1, { type: 'sync_required', seq: 1 })).toBe(false)
    expect(shouldTriggerDeviceSync(2, { type: 'sync_required', seq: 1 })).toBe(false)
    expect(shouldTriggerDeviceSync(2, { type: 'sync_required', seq: 3 })).toBe(true)
  })

  it('persists and restores the device sync cursor for reconnect catch-up', () => {
    expect(readPersistedDeviceSyncSeq()).toBe(null)
    persistDeviceSyncSeq(4)
    expect(readPersistedDeviceSyncSeq()).toBe(4)
    clearPersistedDeviceSyncSeq()
    expect(readPersistedDeviceSyncSeq()).toBe(null)
    expect(shouldTriggerDeviceSync(4, { type: 'sync_required', seq: 5 })).toBe(true)
  })
})
