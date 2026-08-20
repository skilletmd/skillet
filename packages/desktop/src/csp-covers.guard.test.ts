import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The shared cover engine (@skillet/protocol/cover-canvas) rasterizes glyph
 * masks by loading a Blob URL into an <img>. If the webview CSP's img-src
 * doesn't allow blob:, the load fails, paint() bails, and every tray cover
 * silently falls back to the instant SVG layer — no error anywhere. This
 * guard pins the CSP to the engine's needs.
 */
describe('webview CSP supports the cover paint pipeline', () => {
  const conf = JSON.parse(
    readFileSync(join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as { app: { security: { csp: string } } }
  const imgSrc = conf.app.security.csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('img-src '))

  it('img-src allows blob: (cover mask rasterization)', () => {
    expect(imgSrc).toBeDefined()
    expect(imgSrc).toContain('blob:')
  })

  it('a local CSP override keeps img-src blob: (covers survive build:local)', () => {
    // The local config legitimately overrides the CSP now (connect-src gains
    // the local dev registry for the device-sync stream). Tauri's merge
    // replaces the CSP wholesale, so the override must carry the cover
    // pipeline's needs too — csp-config.test.ts enforces the full superset;
    // this pins the one directive covers die without.
    const local = JSON.parse(
      readFileSync(join(__dirname, '..', 'src-tauri', 'tauri.local.conf.json'), 'utf8'),
    ) as { app?: { security?: { csp?: string } } }
    const localCsp = local.app?.security?.csp
    if (localCsp === undefined) return // no override — shipped CSP (checked above) applies
    const localImgSrc = localCsp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('img-src '))
    expect(localImgSrc).toBeDefined()
    expect(localImgSrc).toContain('blob:')
  })
})
