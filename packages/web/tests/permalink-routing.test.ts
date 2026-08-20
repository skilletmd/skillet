import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RESERVED_SKILL_SLUGS } from '@skillet/protocol'
import { skillHref, kitHref, authorKitHref } from '@/lib/urls'

const here = dirname(fileURLToPath(import.meta.url))
const consumer = join(here, '..', 'src', 'app', '(consumer)')

// --- Drift guard the protocol unit test cannot do: the reserved skill-slug set
// MUST equal the static child route segments of app/(consumer)/[author]/. If a
// new static [author]/<segment> route is added without updating the blocklist,
// a skill could be published with that slug yet be shadowed/unreachable. This
// fails CI the moment the route tree and the blocklist drift apart.
//
// Route groups `(name)` are transparent to the URL — their children ARE
// [author]/<segment> routes — so we recurse through them; dynamic `[segment]`
// dirs are excluded.
function staticUrlSegments(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const name = e.name
    if (name.startsWith('[') && name.endsWith(']')) continue // dynamic [skill]
    if (name.startsWith('(') && name.endsWith(')')) {
      out.push(...staticUrlSegments(join(dir, name))) // route group: transparent
      continue
    }
    out.push(name)
  }
  return out
}

describe('reserved skill slugs match the [author] static route segments', () => {
  it('blocklist equals the on-disk static segments', () => {
    const staticSegments = staticUrlSegments(join(consumer, '[author]'))
    expect([...RESERVED_SKILL_SLUGS].sort()).toEqual(staticSegments.sort())
  })
})

// --- Structural guards: the route move actually happened and the old paths are
// redirect shims (not stale copies of the page).
describe('owner-namespaced route structure', () => {
  it('serves skill detail + subroutes under [author]/[skill]', () => {
    for (const p of [
      '[author]/[skill]/page.tsx',
      '[author]/[skill]/edit/page.tsx',
      '[author]/[skill]/propose/page.tsx',
      '[author]/[skill]/review/page.tsx',
    ]) {
      expect(existsSync(join(consumer, p)), p).toBe(true)
    }
  })

  it('serves named kits under [author]/kit/[slug] alongside the everything-kit', () => {
    expect(existsSync(join(consumer, '[author]/kit/[slug]/page.tsx'))).toBe(true)
    expect(existsSync(join(consumer, '[author]/kit/page.tsx'))).toBe(true)
  })

  it('removes the old /skills/{author}/{slug} and /kits/{owner}/{slug} permalinks (pre-launch, no links to preserve)', () => {
    for (const p of ['skills/[author]/[slug]', 'kits/[owner]/[slug]']) {
      expect(existsSync(join(consumer, p)), p).toBe(false)
    }
  })

  it('keeps the /kits/{uuid} resolver that post-create flows link to, pointing at the new permalink', () => {
    // kitHrefFromRecord falls back to /kits/{id} when only the UUID is known
    // (repo import, connect-repo, kit-membership links) — this route resolves it.
    const src = readFileSync(join(consumer, 'kits/[owner]/page.tsx'), 'utf8')
    expect(src).toContain('kitHref')
  })
})

// --- The scheme the shims redirect TO, asserted once more at the integration
// layer so a helper change that breaks the scheme is caught here too.
describe('canonical owner-namespaced scheme', () => {
  it('skills are flat, kits nest under kit/', () => {
    expect(skillHref('maya-writes', 'festival-ops')).toBe('/maya-writes/festival-ops')
    expect(authorKitHref('maya-writes')).toBe('/maya-writes/kit')
    expect(kitHref('maya-writes', 'writers-room')).toBe('/maya-writes/kit/writers-room')
  })
})
