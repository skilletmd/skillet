import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRef,
  toSkillId,
  tryToSkillId,
  toWireRef,
  toSlugDir,
  toSlugDirParts,
  fromSlugDir,
  SkillIdError,
  type SkillId,
} from '../src/skill-id.js'

describe('parseRef — accepts all three input forms', () => {
  it('parses wireRef @owner/slug', () => {
    assert.deepEqual(parseRef('@vercel/deploy'), { owner: 'vercel', slug: 'deploy' })
  })
  it('parses bare owner/slug (no @)', () => {
    assert.deepEqual(parseRef('vercel/deploy'), { owner: 'vercel', slug: 'deploy' })
  })
  it('parses skillId owner:slug', () => {
    assert.deepEqual(parseRef('vercel:deploy'), { owner: 'vercel', slug: 'deploy' })
  })
  it('splits on whichever delimiter comes first', () => {
    // A colon before a slash still splits on the colon.
    assert.deepEqual(parseRef('a:b'), { owner: 'a', slug: 'b' })
  })
  it('accepts single-char owner and slug', () => {
    assert.deepEqual(parseRef('a/b'), { owner: 'a', slug: 'b' })
  })
})

describe('parseRef — rejects malformed', () => {
  const bad = [
    '',
    '@',
    '@/deploy', // empty owner
    'vercel/', // empty slug
    ':deploy', // empty owner
    'vercel:', // empty slug
    'vercel', // no delimiter
    'Vercel/deploy', // uppercase owner
    'vercel/Deploy', // uppercase slug
    'ver cel/deploy', // whitespace
    'vercel/dep loy', // whitespace
    '@ver.cel/deploy', // dot in owner
    'vercel/de.ploy', // dot in slug
    '../deploy', // traversal owner
    'vercel/..', // traversal slug
    '-vercel/deploy', // leading hyphen owner (registry HANDLE_RE forbids leading hyphen)
    'vercel/deploy/extra', // extra segment lands in slug -> bad char
    'ver%cel/deploy', // percent
  ]
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.throws(() => parseRef(input), SkillIdError)
    })
  }
})

describe('parseRef — grammar matches the registry, not a stricter ideal', () => {
  // The registry claim-gate HANDLE_RE is /^[a-z0-9][a-z0-9-]{0,38}$/, which
  // PERMITS a trailing hyphen. `alice-` is therefore a claimable handle and can
  // become a stored `alice-:tool` skills.id — the canonical parser MUST accept
  // it or it throws on real DB rows (500s, my-kits crash).
  it('accepts a trailing-hyphen owner (registry HANDLE_RE permits it)', () => {
    assert.deepEqual(parseRef('alice-:tool'), { owner: 'alice-', slug: 'tool' })
    assert.deepEqual(parseRef('@alice-/tool'), { owner: 'alice-', slug: 'tool' })
    assert.deepEqual(parseRef('alice-/tool'), { owner: 'alice-', slug: 'tool' })
  })
  it('round-trips a trailing-hyphen handle through both canonical forms', () => {
    assert.equal(toSkillId('alice-:tool'), 'alice-:tool')
    assert.equal(toWireRef('alice-:tool'), '@alice-/tool')
    assert.equal(toSkillId('@alice-/tool'), 'alice-:tool')
    assert.equal(toWireRef(toSkillId('@alice-/tool')), '@alice-/tool')
  })
  it('accepts a 39-char handle (HANDLE_RE upper bound) and rejects 40', () => {
    const h39 = 'a' + 'b'.repeat(38) // 39 chars
    assert.equal(toSkillId(`${h39}:tool`), `${h39}:tool`)
    const h40 = 'a' + 'b'.repeat(39) // 40 chars — one past HANDLE_RE
    assert.throws(() => parseRef(`${h40}:tool`), SkillIdError)
  })
  it('still rejects traversal and separators regardless of the looser handle rule', () => {
    assert.throws(() => parseRef('vercel/..'), SkillIdError)
    assert.throws(() => parseRef('../deploy'), SkillIdError)
    assert.throws(() => parseRef('alice-:to\0ol'), SkillIdError) // null byte
  })
})

describe('tryToSkillId — non-throwing variant for untrusted boundaries', () => {
  it('returns the SkillId for valid input (incl. trailing-hyphen handle)', () => {
    assert.equal(tryToSkillId('@vercel/deploy'), 'vercel:deploy')
    assert.equal(tryToSkillId('vercel:deploy'), 'vercel:deploy')
    assert.equal(tryToSkillId('alice-:tool'), 'alice-:tool')
  })
  it('returns null instead of throwing on malformed input', () => {
    assert.equal(tryToSkillId(''), null)
    assert.equal(tryToSkillId('vercel'), null)
    assert.equal(tryToSkillId('../deploy'), null)
    assert.equal(tryToSkillId('Vercel/Deploy'), null)
    assert.equal(tryToSkillId('vercel/..'), null)
    // @ts-expect-error — exercise a non-string at the untrusted boundary
    assert.equal(tryToSkillId(undefined), null)
  })
})

describe('toSkillId / toWireRef — canonical conversions', () => {
  it("toSkillId('@a/b') === 'a:b'", () => {
    assert.equal(toSkillId('@a/b'), 'a:b')
  })
  it("toWireRef('a:b') === '@a/b'", () => {
    assert.equal(toWireRef('a:b'), '@a/b')
  })
  it('round-trips wireRef -> skillId -> wireRef', () => {
    assert.equal(toWireRef(toSkillId('@vercel/deploy')), '@vercel/deploy')
  })
  it('round-trips skillId -> wireRef -> skillId', () => {
    assert.equal(toSkillId(toWireRef('vercel:deploy')), 'vercel:deploy')
  })
  it('normalizes across forms — all three inputs yield the same skillId', () => {
    assert.equal(toSkillId('@vercel/deploy'), 'vercel:deploy')
    assert.equal(toSkillId('vercel/deploy'), 'vercel:deploy')
    assert.equal(toSkillId('vercel:deploy'), 'vercel:deploy')
  })
})

describe('toSlugDir / fromSlugDir — the owner--slug disk form (AE3)', () => {
  it("round-trips vercel:deploy <-> vercel--deploy", () => {
    assert.equal(toSlugDir('vercel:deploy'), 'vercel--deploy')
    assert.deepEqual(fromSlugDir('vercel--deploy'), { owner: 'vercel', slug: 'deploy' })
  })
  it('encodes from any input form', () => {
    assert.equal(toSlugDir('@vercel/deploy'), 'vercel--deploy')
    assert.equal(toSlugDir('vercel/deploy'), 'vercel--deploy')
  })
  it('decodes @owner--slug by stripping the leading @', () => {
    assert.deepEqual(fromSlugDir('@vercel--deploy'), { owner: 'vercel', slug: 'deploy' })
  })
  it('decodes _local--slug as unowned (owner: null)', () => {
    assert.deepEqual(fromSlugDir('_local--my-skill'), { owner: null, slug: 'my-skill' })
  })
  it('encodes unowned parts to _local--slug', () => {
    assert.equal(toSlugDirParts(null, 'my-skill'), '_local--my-skill')
    assert.equal(toSlugDirParts('', 'my-skill'), '_local--my-skill')
    assert.equal(toSlugDirParts('vercel', 'deploy'), 'vercel--deploy')
    assert.equal(toSlugDirParts('@vercel', 'deploy'), 'vercel--deploy')
  })
  it('round-trips unowned via parts <-> fromSlugDir', () => {
    const dir = toSlugDirParts(null, 'my-skill')
    assert.deepEqual(fromSlugDir(dir), { owner: null, slug: 'my-skill' })
  })
  it('maps the reserved skillet dir', () => {
    assert.deepEqual(fromSlugDir('skillet'), { owner: 'skillet', slug: 'route' })
  })
  it('returns null for non-Skillet dir names', () => {
    assert.equal(fromSlugDir('not-a-skilldir'), null)
    assert.equal(fromSlugDir(''), null)
    assert.equal(fromSlugDir('--deploy'), null) // empty owner
  })
  it('rejects path traversal in the slugDir', () => {
    assert.equal(fromSlugDir('foo--..'), null)
    assert.equal(fromSlugDir('foo--../bar'), null)
    assert.equal(fromSlugDir('_local--..'), null)
    assert.equal(fromSlugDir('..--bar'), null)
    assert.equal(fromSlugDir('foo--bar\0baz'), null) // null byte in slug
  })
  it('decodes what bundleSlugDir emits, even a looser slug (round-trip symmetry)', () => {
    // core `bundleSlugDir` emits `_local--<slug>` / `<owner>--<slug>` WITHOUT
    // grammar-validating the slug. An unpublished local skill can carry an
    // underscore slug; the decoder must not reject a dir the encoder wrote.
    assert.deepEqual(fromSlugDir('_local--foo_bar'), { owner: null, slug: 'foo_bar' })
    assert.deepEqual(fromSlugDir('alice--slug'), { owner: 'alice', slug: 'slug' })
    // A trailing-hyphen owner dir (a legal handle) still decodes.
    assert.deepEqual(fromSlugDir('alice--my_skill.v2'), { owner: 'alice', slug: 'my_skill.v2' })
  })
})

describe('SkillId brand — compile-time guard', () => {
  it('a plain string is NOT assignable to SkillId without toSkillId', () => {
    // @ts-expect-error — a raw string cannot be a SkillId; only toSkillId mints one.
    const bad: SkillId = 'vercel:deploy'
    // Runtime is unaffected (the brand is compile-time only), which is the point:
    // the guard costs nothing at runtime and rejects the mismatch at the type level.
    assert.equal(bad, 'vercel:deploy')

    const good: SkillId = toSkillId('vercel:deploy')
    assert.equal(good, 'vercel:deploy')
  })

  it('a SkillId is usable anywhere a string is (it IS a string at runtime)', () => {
    const id: SkillId = toSkillId('@a/b')
    const asString: string = id
    assert.equal(asString, 'a:b')
  })
})
