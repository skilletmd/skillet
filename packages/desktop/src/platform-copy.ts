export type DevicePlatform = 'macos' | 'windows' | 'other'

export function devicePlatform(): DevicePlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  if (/Windows/i.test(ua)) return 'windows'
  return 'other'
}

/** Short noun for the local machine in tray copy. */
export function deviceNoun(): string {
  const p = devicePlatform()
  if (p === 'macos') return 'this Mac'
  if (p === 'windows') return 'this PC'
  return 'this device'
}

export function findOnDeviceLabel(busy: boolean): string {
  if (busy) return 'Looking…'
  const p = devicePlatform()
  if (p === 'macos') return 'Find on this Mac'
  if (p === 'windows') return 'Find on this PC'
  return 'Find on this device'
}

export function uploadEmptyHint(): string {
  return `Nothing to upload yet. Find skills on ${deviceNoun()} first.`
}

export function isMacOsDesktop(): boolean {
  return devicePlatform() === 'macos'
}

