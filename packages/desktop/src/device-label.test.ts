import { describe, it, expect } from 'vitest'
import { normalizeDeviceLabel, DEVICE_LABEL_MAX } from './device-label'

describe('normalizeDeviceLabel', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeDeviceLabel('  work laptop  ')).toBe('work laptop')
  })

  it('passes normal labels through (AE3)', () => {
    expect(normalizeDeviceLabel('work laptop')).toBe('work laptop')
  })

  it('empty and whitespace-only mean cancel (null), never a null-label save', () => {
    expect(normalizeDeviceLabel('')).toBeNull()
    expect(normalizeDeviceLabel('   ')).toBeNull()
    expect(normalizeDeviceLabel('\t\n')).toBeNull()
  })

  it('caps at the server clamp so nothing silently truncates later', () => {
    const long = 'x'.repeat(DEVICE_LABEL_MAX + 20)
    expect(normalizeDeviceLabel(long)).toBe('x'.repeat(DEVICE_LABEL_MAX))
  })
})
