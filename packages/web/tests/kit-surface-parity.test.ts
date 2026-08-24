import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every surface that lets you add a kit owes the same second half.
 *
 * Adding puts something on your account and nothing on your machine, so each of
 * these pages has to answer "and where does it land". They already share
 * `KitPageLayout`, and the author-kit page's own comment claimed that shell
 * meant the two "can't drift" — they drifted anyway, because the shell shares
 * the chrome while `action` is arbitrary JSX each route passes in. That slot is
 * the hole every divergence has come through.
 *
 * This walks the app directory rather than naming the two routes we know about,
 * so a THIRD kit surface added later fails here instead of shipping a page that
 * takes an Add and then says nothing.
 */
const APP = join(process.cwd(), 'src/app/(consumer)')

function pagesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full))
    else if (entry === 'page.tsx') out.push(full)
  }
  return out
}

/** Routes whose shell is KitPageLayout: the kit surfaces, however they are named. */
function kitSurfaces(): { path: string; src: string }[] {
  return pagesUnder(APP)
    .map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    .filter((f) => f.src.includes('KitPageLayout'))
}

describe('every kit surface answers Add the same way', () => {
  it('finds the kit surfaces at all', () => {
    // A guard on the guard: if the walk or the KitPageLayout marker breaks, the
    // assertions below would pass vacuously over an empty list.
    const found = kitSurfaces()
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('gives each one an action row that renders the delivery bar', () => {
    // Match the RENDERED element, not any mention: a stale import of the row
    // left behind after someone swaps the JSX back to a bare button would
    // otherwise satisfy this and the guard would never fire.
    const missing = kitSurfaces()
      .filter((f) => !/<\w*ActionRow[\s/>]/.test(f.src))
      .map((f) => f.path.replace(process.cwd(), ''))

    // The action slot takes arbitrary JSX, so a new kit page can pass a bare
    // button and look finished. Each surface routes through an *ActionRow that
    // pairs the button with the shared bar.
    expect(missing).toEqual([])
  })

  it('routes every action row through the one shared bar', () => {
    const rows = readdirSync(join(process.cwd(), 'src/components/kits'))
      .filter((f) => f.endsWith('action-row.tsx'))
      .map((f) => join(process.cwd(), 'src/components/kits', f))

    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const row of rows) {
      const src = readFileSync(row, 'utf8')
      // Not a copy of the bar: the same DeliveryBar. Two implementations would
      // answer the same question differently depending on where you landed.
      expect(src, `${row} should use the shared DeliveryBar`).toContain('DeliveryBar')
      expect(src, `${row} should not re-implement the bar`).not.toContain('AnimatePresence')
    }
  })

  it('feeds the bar the viewer state it needs on every surface', () => {
    for (const { path, src } of kitSurfaces()) {
      const rel = path.replace(process.cwd(), '')
      // Without these the bar cannot tell "installed nowhere" from "ready in
      // your agents", and silently renders the install state to everyone.
      expect(src, `${rel} should pass runtimes`).toMatch(/runtimes=\{/)
      expect(src, `${rel} should pass mcpUrl`).toMatch(/mcpUrl=\{/)
    }
  })
})

describe('the Add button is the same size everywhere it is the page question', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('renders lg on all three detail pages', () => {
    // Kit, skill, and author kit each make the SAME request of the reader, so
    // it cannot look like a bigger decision on one of them. These three drifted
    // once already: the author kit fell back to Button's default md while the
    // other two asked for lg.
    const kit = read('src/components/kits/subscribe-kit-button.tsx')
    const skill = read('src/components/kits/skill-kit-control.tsx')
    const authorKit = read('src/components/kits/subscribe-author-button.tsx')

    expect(kit).toMatch(/size:\s*hero\s*\?\s*'lg'/)
    expect(skill).toMatch(/size:\s*variant === 'hero'\s*\?\s*'lg'/)
    expect(authorKit).toMatch(/size=\{hero \? 'lg'/)
  })

  it('gives every detail page a hero flag to pass', () => {
    // The bug was an omission, not a wrong value: the author kit had no way to
    // say "this is the page's CTA", so it silently got the row-sized default.
    for (const rel of [
      'src/components/kits/subscribe-kit-button.tsx',
      'src/components/kits/subscribe-author-button.tsx',
    ]) {
      expect(read(rel), `${rel} should accept a hero flag`).toMatch(/hero\s*[?=]/)
    }
  })

  it('has each action row actually pass it', () => {
    const rows = readdirSync(join(process.cwd(), 'src/components/kits'))
      .filter((f) => f.endsWith('action-row.tsx'))

    for (const f of rows) {
      const src = read(join('src/components/kits', f))
      expect(src, `${f} should mark its button as the page CTA`).toMatch(/\bhero\b/)
    }
  })
})
