import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import type { DecodedBundle } from '@skillet/protocol';
import {
  bundleToZip,
  bundlesToZip,
  frontmatterCompatWarnings,
} from '../src/bundle/zip.js';

function bundle(entries: Record<string, string>): DecodedBundle {
  const m: DecodedBundle = new Map();
  for (const [k, v] of Object.entries(entries)) {
    m.set(k, new TextEncoder().encode(v));
  }
  return m;
}

const SKILL = '---\nname: demo\ndescription: A demo skill\n---\nBody.';

describe('bundleToZip', () => {
  it('packs a SKILL.md-only bundle with the entrypoint at the root', () => {
    const zip = bundleToZip(bundle({ 'SKILL.md': SKILL }));
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(['SKILL.md']);
    expect(new TextDecoder().decode(out['SKILL.md'])).toBe(SKILL);
  });

  it('preserves the full supporting-file tree and relative paths', () => {
    const b = bundle({
      'SKILL.md': SKILL,
      'scripts/run.sh': 'echo hi',
      'references/notes.md': '# notes',
    });
    const out = unzipSync(bundleToZip(b));
    expect(Object.keys(out).sort()).toEqual([
      'SKILL.md',
      'references/notes.md',
      'scripts/run.sh',
    ]);
    expect(new TextDecoder().decode(out['scripts/run.sh'])).toBe('echo hi');
  });

  it('throws when the bundle has no SKILL.md', () => {
    expect(() => bundleToZip(bundle({ 'notes.md': 'x' }))).toThrow(/SKILL\.md/);
  });

  it('produces byte-identical output across calls (deterministic)', () => {
    const b = bundle({ 'SKILL.md': SKILL, 'scripts/run.sh': 'echo hi' });
    const a = bundleToZip(b);
    const c = bundleToZip(b);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(true);
  });

  it('rejects a path-traversal entry before producing any bytes', () => {
    const b = bundle({ 'SKILL.md': SKILL });
    b.set('../evil', new TextEncoder().encode('pwned'));
    expect(() => bundleToZip(b)).toThrow();
  });

  it('nests under a prefix when requested', () => {
    const out = unzipSync(
      bundleToZip(bundle({ 'SKILL.md': SKILL }), { prefix: '@taylor--demo' }),
    );
    expect(Object.keys(out)).toEqual(['@taylor--demo/SKILL.md']);
  });
});

describe('bundlesToZip', () => {
  it('packs multiple skills under collision-free prefixes', () => {
    const out = unzipSync(
      bundlesToZip([
        { prefix: '@a--one', bundle: bundle({ 'SKILL.md': SKILL }) },
        { prefix: '@b--two', bundle: bundle({ 'SKILL.md': SKILL }) },
      ]),
    );
    expect(Object.keys(out).sort()).toEqual([
      '@a--one/SKILL.md',
      '@b--two/SKILL.md',
    ]);
  });
});

describe('frontmatterCompatWarnings', () => {
  it('flags frontmatter keys beyond name/description', () => {
    const b = bundle({
      'SKILL.md': '---\nname: x\ndescription: y\nversion: 1.0.0\n---\nBody.',
    });
    expect(frontmatterCompatWarnings(b)).toEqual(['version']);
  });

  it('returns no warnings for a clean name+description skill', () => {
    expect(frontmatterCompatWarnings(bundle({ 'SKILL.md': SKILL }))).toEqual([]);
  });
});
