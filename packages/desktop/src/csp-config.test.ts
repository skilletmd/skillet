// KTD5 drift guard: tauri's --config merge replaces app.security.csp
// wholesale, so tauri.local.conf.json carries a full copy of the shipped CSP.
// A shipped-CSP edit that forgets the local mirror would make build:local
// silently test a different policy than what ships — this fails loudly instead.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function cspDirectives(confPath: string): Map<string, Set<string>> {
  const conf = JSON.parse(readFileSync(confPath, 'utf8')) as {
    app?: { security?: { csp?: string } }
  }
  const csp = conf.app?.security?.csp
  expect(csp, `${confPath} must define app.security.csp`).toBeTruthy()
  const map = new Map<string, Set<string>>()
  for (const directive of String(csp).split(';')) {
    const [name, ...values] = directive.trim().split(/\s+/)
    if (name) map.set(name, new Set(values))
  }
  return map
}

const tauriDir = join(__dirname, '..', 'src-tauri')

describe('desktop CSP configs', () => {
  it('local override is a strict superset of the shipped CSP', () => {
    const shipped = cspDirectives(join(tauriDir, 'tauri.conf.json'))
    const local = cspDirectives(join(tauriDir, 'tauri.local.conf.json'))
    for (const [name, values] of shipped) {
      const localValues = local.get(name)
      expect(localValues, `local CSP missing directive ${name}`).toBeTruthy()
      for (const v of values) {
        expect(localValues!.has(v), `local CSP ${name} missing ${v}`).toBe(true)
      }
    }
  })

  it('shipped connect-src admits the production registry for the sync stream', () => {
    const shipped = cspDirectives(join(tauriDir, 'tauri.conf.json'))
    expect(shipped.get('connect-src')?.has('https://registry.skillet.md')).toBe(true)
  })

  it('local connect-src additionally admits the local dev registry', () => {
    const local = cspDirectives(join(tauriDir, 'tauri.local.conf.json'))
    expect(local.get('connect-src')?.has('http://localhost:3481')).toBe(true)
  })
})
