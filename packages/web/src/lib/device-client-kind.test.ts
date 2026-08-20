import { describe, expect, it } from 'vitest'
import {
  deviceClientKindLabel,
  deviceClientKindsIcons,
  deviceClientKindsLabel,
} from './device-client-kind'

describe('deviceClientKindLabel', () => {
  it('labels CLI pairs', () => {
    expect(deviceClientKindLabel('cli')).toBe('CLI')
    expect(deviceClientKindLabel('cli', 'windows')).toBe('CLI')
  })

  it('labels desktop pairs by platform', () => {
    expect(deviceClientKindLabel('desktop', 'macos')).toBe('Mac app')
    expect(deviceClientKindLabel('desktop', 'windows')).toBe('Windows app')
  })

  it('uses neutral App for legacy desktop rows', () => {
    expect(deviceClientKindLabel('desktop')).toBe('App')
    expect(deviceClientKindLabel('desktop', null)).toBe('App')
    expect(deviceClientKindLabel('desktop', 'linux')).toBe('App')
  })

  it('returns null for unknown kinds', () => {
    expect(deviceClientKindLabel(null)).toBeNull()
    expect(deviceClientKindLabel('web')).toBeNull()
  })
})

describe('deviceClientKindsIcons', () => {
  it('renders one icon per kind, app first, terminal second', () => {
    expect(deviceClientKindsIcons(['cli', 'desktop'], 'macos', 'iMac')).toEqual([
      'desktop',
      'terminal',
    ])
    expect(deviceClientKindsIcons(['desktop', 'cli'], 'macos', "Taylor's MacBook Pro")).toEqual([
      'laptop',
      'terminal',
    ])
  })

  it('renders single-kind sets like the single-kind helper', () => {
    expect(deviceClientKindsIcons(['cli'])).toEqual(['terminal'])
    expect(deviceClientKindsIcons(['desktop'], 'windows')).toEqual(['windows'])
  })

  it('drops unknown kinds instead of guessing a glyph', () => {
    expect(deviceClientKindsIcons(['web', 'toaster'])).toEqual([])
    expect(deviceClientKindsIcons(['cli', 'web'])).toEqual(['terminal'])
  })

  it('returns [] for empty or missing sets', () => {
    expect(deviceClientKindsIcons([])).toEqual([])
    expect(deviceClientKindsIcons(null)).toEqual([])
    expect(deviceClientKindsIcons(undefined)).toEqual([])
  })
})

describe('deviceClientKindsLabel', () => {
  it('joins kind labels app-first', () => {
    expect(deviceClientKindsLabel(['cli', 'desktop'], 'macos')).toBe('Mac app and CLI')
    expect(deviceClientKindsLabel(['desktop', 'cli'], 'windows')).toBe('Windows app and CLI')
  })

  it('labels single kinds without a joiner', () => {
    expect(deviceClientKindsLabel(['cli'])).toBe('CLI')
    expect(deviceClientKindsLabel(['desktop'], 'macos')).toBe('Mac app')
  })

  it('returns null for empty, missing, or unknown-only sets', () => {
    expect(deviceClientKindsLabel([])).toBeNull()
    expect(deviceClientKindsLabel(null)).toBeNull()
    expect(deviceClientKindsLabel(['web'])).toBeNull()
  })
})
