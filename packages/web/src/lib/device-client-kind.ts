/** Human label for a sync device's client_kind from the registry. */
export function deviceClientKindLabel(
  kind: string | null | undefined,
  platform?: string | null,
): string | null {
  if (kind === 'cli') return 'CLI'
  if (kind === 'desktop') {
    if (platform === 'macos') return 'Mac app'
    if (platform === 'windows') return 'Windows app'
    return 'App'
  }
  return null
}

/** Which glyph represents how a sync device was connected / what it is. */
export type DeviceClientIcon = 'apple' | 'windows' | 'terminal' | 'laptop' | 'desktop'

/**
 * Form factor guessed from the device's name. Default labels are the machine's
 * computer name ("Taylor's MacBook Pro", "iMac"), so the model is often right
 * there — we use it when present and fall back to the platform logo otherwise.
 */
function formFactorFromLabel(label?: string | null): 'laptop' | 'desktop' | null {
  if (!label) return null
  const l = label.toLowerCase()
  if (/\b(macbook|laptop|notebook|thinkpad|xps|surface|zenbook|gram)\b/.test(l)) return 'laptop'
  if (/(imac|mac ?mini|mac ?studio|mac ?pro|desktop|tower|workstation)/.test(l)) return 'desktop'
  return null
}

/** Icon key for a sync device, or null if the source is unknown. */
export function deviceClientKindIcon(
  kind: string | null | undefined,
  platform?: string | null,
  label?: string | null,
): DeviceClientIcon | null {
  if (kind === 'cli') return 'terminal'
  if (kind === 'desktop') {
    const form = formFactorFromLabel(label)
    if (form) return form
    if (platform === 'macos') return 'apple'
    if (platform === 'windows') return 'windows'
    return 'terminal'
  }
  return null
}

// Display order for a machine's kind set: the app (form factor) leads, the
// terminal follows. Unknown kinds render nothing rather than a wrong glyph.
const KIND_DISPLAY_ORDER = ['desktop', 'cli'] as const

/** Ordered icon list for every client kind a machine has connected with. */
export function deviceClientKindsIcons(
  kinds: string[] | null | undefined,
  platform?: string | null,
  label?: string | null,
): DeviceClientIcon[] {
  if (!kinds || kinds.length === 0) return []
  const icons: DeviceClientIcon[] = []
  for (const kind of KIND_DISPLAY_ORDER) {
    if (!kinds.includes(kind)) continue
    const icon = deviceClientKindIcon(kind, platform, label)
    if (icon && !icons.includes(icon)) icons.push(icon)
  }
  return icons
}

/** Combined human label for a kind set, e.g. "Mac app and CLI". */
export function deviceClientKindsLabel(
  kinds: string[] | null | undefined,
  platform?: string | null,
): string | null {
  if (!kinds || kinds.length === 0) return null
  const labels: string[] = []
  for (const kind of KIND_DISPLAY_ORDER) {
    if (!kinds.includes(kind)) continue
    const label = deviceClientKindLabel(kind, platform)
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels.length > 0 ? labels.join(' and ') : null
}
