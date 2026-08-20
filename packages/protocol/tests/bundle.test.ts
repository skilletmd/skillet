import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  BundleError,
  CONTENT_HASH_PREFIX,
  MAX_BUNDLE_BYTES,
  MAX_INSTRUCTION_BYTES,
  assertSafeBundlePath,
  bundlePathError,
  canonicalContentHash,
  skillContentHash,
  computeInstructionClosure,
  decodeBundle,
  encodeBundle,
  isInstructionPath,
  validateBundle,
} from '../src/bundle.js';

// ---------------------------------------------------------------------------
// Cross-implementation determinism fixture.
//
// A wire payload published from any conforming client MUST produce the
// recorded `content_hash` below. If this test ever fails, the canonical hash
// changed and every signed version, lockfile, and adapter manifest in the
// wild has to be re-verified — exactly the break §2.2 exists to prevent.
//
// The expected hash is derived in this same test from the §2.2 byte recipe,
// not pasted in as a magic number, so the test self-documents the recipe.
// A second implementation (e.g. Go, Python) can reproduce it by following:
//
//   sha256( for each path in lex byte order:
//             u64be(len(utf8(path))) || utf8(path) ||
//             u64be(len(content))    || raw_content_bytes )
// ---------------------------------------------------------------------------

const FIXTURE_BINARY = Buffer.from([0xff, 0x00, 0x01, 0x80, 0x7f]); // not valid UTF-8
const FIXTURE_SKILL_MD = '---\nname: fixture\ndescription: cross-impl hash fixture\n---\n# Fixture\n';
const FIXTURE_REFERENCE = 'See policy.pdf — binary reference.\n';
const FIXTURE_AGENT = '---\nname: reviewer\n---\nReview the change.\n';

const FIXTURE_FILES = {
  'SKILL.md': { enc: 'utf8' as const, data: FIXTURE_SKILL_MD },
  'references/policy.pdf': { enc: 'base64' as const, data: FIXTURE_BINARY.toString('base64') },
  'references/readme.md': { enc: 'utf8' as const, data: FIXTURE_REFERENCE },
  'agents/reviewer.md': { enc: 'utf8' as const, data: FIXTURE_AGENT },
};

function recipeHash(files: Record<string, Buffer>): string {
  const h = createHash('sha256');
  const u64be = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    return b;
  };
  const sortedPaths = Object.keys(files).sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')),
  );
  for (const p of sortedPaths) {
    const pathBytes = Buffer.from(p, 'utf8');
    h.update(u64be(pathBytes.length));
    h.update(pathBytes);
    h.update(u64be(files[p]!.length));
    h.update(files[p]!);
  }
  return CONTENT_HASH_PREFIX + h.digest('hex');
}

describe('protocol/bundle: canonical hash (§2.2)', () => {
  it('is prefixed sha256: and 64 hex chars', () => {
    const bundle = decodeBundle(FIXTURE_FILES);
    const hash = canonicalContentHash(bundle);
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  });

  it('matches the §2.2 byte recipe applied directly', () => {
    const decoded = decodeBundle(FIXTURE_FILES);
    const hash = canonicalContentHash(decoded);
    const expected = recipeHash({
      'SKILL.md': Buffer.from(FIXTURE_SKILL_MD, 'utf8'),
      'references/policy.pdf': FIXTURE_BINARY,
      'references/readme.md': Buffer.from(FIXTURE_REFERENCE, 'utf8'),
      'agents/reviewer.md': Buffer.from(FIXTURE_AGENT, 'utf8'),
    });
    assert.equal(hash, expected);
  });

  it('is invariant to wire encoding (utf8 vs base64 of same bytes)', () => {
    // Encode SKILL.md as base64 of its UTF-8 bytes — same bytes, different wire encoding.
    const reEncoded = {
      ...FIXTURE_FILES,
      'SKILL.md': {
        enc: 'base64' as const,
        data: Buffer.from(FIXTURE_SKILL_MD, 'utf8').toString('base64'),
      },
    };
    const a = canonicalContentHash(decodeBundle(FIXTURE_FILES));
    const b = canonicalContentHash(decodeBundle(reEncoded));
    assert.equal(a, b);
  });

  it('is invariant to wire key order', () => {
    // Build an alternative ordering — hash MUST be identical (paths sorted internally).
    const keys = Object.keys(FIXTURE_FILES);
    const shuffled: Record<string, (typeof FIXTURE_FILES)[keyof typeof FIXTURE_FILES]> = {};
    for (const k of keys.reverse()) {
      shuffled[k] = FIXTURE_FILES[k as keyof typeof FIXTURE_FILES];
    }
    const a = canonicalContentHash(decodeBundle(FIXTURE_FILES));
    const b = canonicalContentHash(decodeBundle(shuffled));
    assert.equal(a, b);
  });

  it('skillContentHash excludes .skillet-backup paths from the canonical hash', () => {
    const decoded = decodeBundle(FIXTURE_FILES);
    const polluted = new Map(decoded);
    polluted.set('SKILL.md.skillet-backup', Buffer.from('stale backup', 'utf8'));
    assert.notEqual(canonicalContentHash(polluted), canonicalContentHash(decoded));
    assert.equal(skillContentHash(polluted), canonicalContentHash(decoded));
  });

  it('changes when any single byte in any path changes', () => {
    const a = canonicalContentHash(decodeBundle(FIXTURE_FILES));
    const mutated = {
      ...FIXTURE_FILES,
      'SKILL.md': { enc: 'utf8' as const, data: FIXTURE_SKILL_MD + ' ' },
    };
    const b = canonicalContentHash(decodeBundle(mutated));
    assert.notEqual(a, b);
  });

  it('distinguishes path A+contents from path B+contents (framing matters)', () => {
    // {path:"ab", content:"c"} and {path:"a", content:"bc"} must not collide.
    // The length-prefixed framing (u64be(len) before each field) keeps the
    // path/content boundary unambiguous, so these hash differently.
    const a = canonicalContentHash(
      decodeBundle({
        'SKILL.md': { enc: 'utf8', data: 'x' },
        ab: { enc: 'utf8', data: 'c' },
      }),
    );
    const b = canonicalContentHash(
      decodeBundle({
        'SKILL.md': { enc: 'utf8', data: 'x' },
        a: { enc: 'utf8', data: 'bc' },
      }),
    );
    assert.notEqual(a, b);
  });

  it('closes the NUL-in-content collision the old 0x00 framing allowed', () => {
    // Under the old `path || 0x00 || content || 0x00` framing, these two
    // DIFFERENT bundles serialized to the identical byte stream
    // (61 00 62 00 63 00) and collided — a content NUL aliased the separator.
    // Length-prefixed framing makes them distinct.
    const nullInPath = canonicalContentHash(new Map([['a\u0000b', Buffer.from('c')]]));
    const nullInContent = canonicalContentHash(new Map([['a', Buffer.from('b\u0000c')]]));
    assert.notEqual(nullInPath, nullInContent);
  });
});

describe('protocol/bundle: decode + encode round-trip', () => {
  it('round-trips utf8 and base64 cleanly', () => {
    const decoded = decodeBundle(FIXTURE_FILES);
    const reWire = encodeBundle(decoded);
    const decodedAgain = decodeBundle(reWire);
    assert.equal(canonicalContentHash(decoded), canonicalContentHash(decodedAgain));
  });

  it('encodes byte-clean text as utf8, opaque binary as base64', () => {
    const wire = encodeBundle(
      new Map<string, Uint8Array>([
        ['SKILL.md', Buffer.from('hello world', 'utf8')],
        ['references/policy.pdf', FIXTURE_BINARY],
      ]),
    );
    assert.equal(wire['SKILL.md']!.enc, 'utf8');
    assert.equal(wire['references/policy.pdf']!.enc, 'base64');
  });

  it('does not attach keys to Object.prototype', () => {
    const polluted = Object.prototype as { encodeBundleProbe?: boolean };
    delete polluted.encodeBundleProbe;
    const decoded = new Map<string, Uint8Array>([['SKILL.md', Buffer.from('probe', 'utf8')]]);
    const wire = encodeBundle(decoded);
    assert.equal(polluted.encodeBundleProbe, undefined);
    assert.ok(Object.hasOwn(wire, 'SKILL.md'));
  });

  it('rejects non-canonical base64 (would create hash ambiguity)', () => {
    assert.throws(
      () =>
        decodeBundle({
          'SKILL.md': { enc: 'utf8', data: 'hi' },
          'binary.bin': { enc: 'base64', data: 'not valid base64!!!' },
        }),
      (err: unknown) => err instanceof BundleError && err.code === 'unsafe_path',
    );
  });

  it('rejects unknown encoding', () => {
    assert.throws(
      () =>
        decodeBundle({
          'SKILL.md': {
            enc: 'rot13' as unknown as 'utf8',
            data: 'uvyy gnzr lbh ner gur ovagn',
          },
        }),
      (err: unknown) => err instanceof BundleError,
    );
  });
});

describe('protocol/bundle: path safety (§2.1)', () => {
  it('rejects absolute paths', () => {
    assert.throws(() => assertSafeBundlePath('/etc/passwd'), BundleError);
  });
  it('rejects .. segments', () => {
    assert.throws(() => assertSafeBundlePath('../foo'), BundleError);
    assert.throws(() => assertSafeBundlePath('a/../b'), BundleError);
  });
  it('rejects . segments', () => {
    assert.throws(() => assertSafeBundlePath('./foo'), BundleError);
    assert.throws(() => assertSafeBundlePath('a/./b'), BundleError);
  });
  it('rejects backslash (Windows separator)', () => {
    assert.throws(() => assertSafeBundlePath('a\\b'), BundleError);
  });
  it('rejects null byte', () => {
    assert.throws(() => assertSafeBundlePath('a\0b'), BundleError);
  });
  it('rejects empty path', () => {
    assert.throws(() => assertSafeBundlePath(''), BundleError);
  });
  it('rejects empty segments', () => {
    assert.throws(() => assertSafeBundlePath('a//b'), BundleError);
  });
  it('rejects trailing separator', () => {
    assert.throws(() => assertSafeBundlePath('a/b/'), BundleError);
  });
  it('accepts deep POSIX-relative paths', () => {
    assert.doesNotThrow(() => assertSafeBundlePath('SKILL.md'));
    assert.doesNotThrow(() => assertSafeBundlePath('scripts/lib/util/format.py'));
    assert.doesNotThrow(() => assertSafeBundlePath('references/01_profile.md'));
  });
  it('rejects dotfiles and agent-control paths (NF-005)', () => {
    assert.throws(() => assertSafeBundlePath('.bashrc'), BundleError);
    assert.throws(() => assertSafeBundlePath('.git/hooks/post-checkout'), BundleError);
    assert.throws(() => assertSafeBundlePath('.claude/settings.json'), BundleError);
    assert.throws(() => assertSafeBundlePath('__proto__'), BundleError);
    assert.throws(() => assertSafeBundlePath('settings.json'), BundleError);
    assert.throws(() => assertSafeBundlePath('scripts/hooks/pre-run.sh'), BundleError);
  });

  it('bundlePathError mirrors assertSafeBundlePath', () => {
    assert.equal(bundlePathError('SKILL.md'), null);
    assert.notEqual(bundlePathError('settings.json'), null);
    assert.notEqual(bundlePathError('.git/config'), null);
  });
});

describe('protocol/bundle: validation (§2.1 invariants)', () => {
  function bundleOf(entries: Record<string, string>): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const [k, v] of Object.entries(entries)) {
      out.set(k, Buffer.from(v, 'utf8'));
    }
    return out;
  }

  it('rejects bundle missing SKILL.md at root', () => {
    const b = bundleOf({ 'docs/SKILL.md': 'no' });
    assert.throws(
      () => validateBundle(b),
      (err: unknown) => err instanceof BundleError && err.code === 'unsafe_path',
    );
  });

  it('rejects a single unsafe path even if SKILL.md exists', () => {
    const b = bundleOf({ 'SKILL.md': 'ok', '../escape': 'no' });
    assert.throws(() => validateBundle(b), BundleError);
  });

  it('rejects bundle over the 25 MB cap', () => {
    const b = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('hi', 'utf8')],
      // 25 MB + 1 byte payload
      ['references/big.bin', Buffer.alloc(MAX_BUNDLE_BYTES + 1, 0)],
    ]);
    assert.throws(
      () => validateBundle(b),
      (err: unknown) => err instanceof BundleError && err.code === 'bundle_too_large',
    );
  });

  it('rejects instruction total over 1 MB', () => {
    const b = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.alloc(MAX_INSTRUCTION_BYTES + 1, 0x61)],
    ]);
    assert.throws(
      () => validateBundle(b),
      (err: unknown) => err instanceof BundleError && err.code === 'instruction_too_large',
    );
  });

  it('accepts a minimal valid bundle', () => {
    assert.doesNotThrow(() =>
      validateBundle(
        new Map<string, Uint8Array>([['SKILL.md', Buffer.from('---\nname: x\n---\n', 'utf8')]]),
      ),
    );
  });

  it('does NOT count references/ toward the instruction budget unless required_reading', () => {
    const b = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('x', 'utf8')],
      ['references/big.md', Buffer.alloc(MAX_INSTRUCTION_BYTES + 512 * 1024, 0x61)],
    ]);
    assert.doesNotThrow(() => validateBundle(b));
  });

  it('counts references/ declared in required_reading toward the instruction budget', () => {
    const b = new Map<string, Uint8Array>([
      [
        'SKILL.md',
        Buffer.from(
          '---\nname: x\nrequired_reading:\n  - references/big.md\n---\n',
          'utf8',
        ),
      ],
      ['references/big.md', Buffer.alloc(MAX_INSTRUCTION_BYTES + 1, 0x61)],
    ]);
    assert.throws(
      () => validateBundle(b),
      (err: unknown) => err instanceof BundleError && err.code === 'instruction_too_large',
    );
  });

  it('does NOT count agents/*.md unless listed in required_reading', () => {
    const b = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('---\nname: x\n---\n', 'utf8')],
      ['agents/reviewer.md', Buffer.alloc(MAX_INSTRUCTION_BYTES + 1, 0x61)],
    ]);
    assert.doesNotThrow(() => validateBundle(b));
  });

  it('resolves required_reading globs against the bundle manifest', () => {
    const b = new Map<string, Uint8Array>([
      [
        'SKILL.md',
        Buffer.from('---\nname: x\nrequired_reading:\n  - playbooks/*.md\n---\n', 'utf8'),
      ],
      ['playbooks/a.md', Buffer.from('a', 'utf8')],
      ['playbooks/b.md', Buffer.from('b', 'utf8')],
    ]);
    const closure = computeInstructionClosure(b);
    assert.equal(closure.size, 3);
    assert.ok(closure.has('playbooks/a.md'));
    assert.ok(closure.has('playbooks/b.md'));
  });

  it('rejects pathological required_reading globs', () => {
    const longGlob = '*'.repeat(200);
    const b = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from(`---\nname: x\nrequired_reading:\n  - ${longGlob}\n---\n`, 'utf8')],
      ['a.md', Buffer.from('a', 'utf8')],
    ]);
    assert.throws(() => computeInstructionClosure(b), (err: unknown) => {
      return err instanceof Error && err.message.includes('required_reading glob exceeds');
    });
  });
});

describe('protocol/bundle: instruction classification', () => {
  it('classifies SKILL.md and agents/*.md as instructions', () => {
    assert.equal(isInstructionPath('SKILL.md'), true);
    assert.equal(isInstructionPath('agents/reviewer.md'), true);
  });
  it('excludes references/, scripts/, evals/, tools/', () => {
    assert.equal(isInstructionPath('references/policy.md'), false);
    assert.equal(isInstructionPath('scripts/run.py'), false);
    assert.equal(isInstructionPath('evals/cases.json'), false);
    assert.equal(isInstructionPath('tools/x.json'), false);
  });
});
