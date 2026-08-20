/** Install funnel platform — drives /install hero, steps, and trust pills. */
export type InstallPlatform = 'mac' | 'windows' | 'linux' | 'mobile'

/**
 * Classify the visitor OS from UA + platform strings.
 * Pure function so we can unit-test and call from server (headers) and client (navigator).
 */
export function detectInstallPlatform(userAgent: string, platform: string): InstallPlatform {
  const ua = userAgent || ''
  const plat = platform || ''

  const isMobile =
    /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (/\biPad\b/i.test(ua) && !/Macintosh/i.test(ua))

  if (isMobile) return 'mobile'

  const isMac =
    /Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua) || plat === 'MacIntel' || plat === 'MacPPC'

  if (isMac) return 'mac'

  const isWindows = /Windows/i.test(ua) || /Win32|Win64/i.test(plat)
  if (isWindows) return 'windows'

  return 'linux'
}
