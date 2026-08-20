// HTML escaping for the tray.
//
// Tray views assign built strings to innerHTML, and several interpolated fields
// (skill names, slugs, bundle paths) come from untrusted local content, so
// every untrusted field MUST pass through escapeHtml first.

export const escapeHtml = (s: string): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
