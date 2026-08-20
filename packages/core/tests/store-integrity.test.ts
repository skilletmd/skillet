import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalContentHash, skillContentHash } from '@skillet/protocol';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs');
  return redirectHome('skillet-store-integrity-test');
});

import {
  readSkillStoreContentHash,
  skillStoreMatchesExpectedHash,
} from '../src/kit/store-integrity.js';
import { writeBundleToSkillStore } from '../src/kit/store.js';

function bundleOf(text: string) {
  return new Map([
    [
      'SKILL.md',
      Buffer.from(
        `---\nname: test-skill\ndescription: x\n---\n${text}\n`,
        'utf8',
      ),
    ],
  ]);
}

describe('store-integrity', () => {
  beforeEach(async () => {
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  it('returns matches true when store bytes hash to expected', async () => {
    const bundle = bundleOf('aligned');
    await writeBundleToSkillStore('@alice/test-skill', bundle);
    const expected = skillContentHash(bundle);
    expect(await skillStoreMatchesExpectedHash('@alice/test-skill', expected)).toBe(true);
    expect(await readSkillStoreContentHash('@alice/test-skill')).toBe(expected);
  });

  it('returns matches false when store bytes differ from expected', async () => {
    const bundle = bundleOf('wrong bytes');
    await writeBundleToSkillStore('@alice/test-skill', bundle);
    const other = skillContentHash(bundleOf('other'));
    expect(await skillStoreMatchesExpectedHash('@alice/test-skill', other)).toBe(false);
  });

  it('returns null hash and false match when skill store is missing', async () => {
    expect(await readSkillStoreContentHash('@alice/missing-skill')).toBeNull();
    expect(
      await skillStoreMatchesExpectedHash('@alice/missing-skill', 'sha256:' + 'a'.repeat(64)),
    ).toBe(false);
  });

  it('ignores .skillet-backup files when hashing store bytes', async () => {
    const bundle = bundleOf('no backup noise');
    await writeBundleToSkillStore('@alice/test-skill', bundle);
    const expected = skillContentHash(bundle);
    const skillDir = join(TEST_ROOT, '.skillet', 'skills', '@alice', 'test-skill');
    await writeFile(join(skillDir, 'SKILL.md.skillet-backup'), 'stale backup content', 'utf8');
    expect(await readSkillStoreContentHash('@alice/test-skill')).toBe(expected);
    expect(await skillStoreMatchesExpectedHash('@alice/test-skill', expected)).toBe(true);
  });

  it('matches legacy polluted entry hashes that counted .skillet-backup paths', async () => {
    const bundle = bundleOf('legacy polluted');
    const polluted = new Map(bundle);
    polluted.set('SKILL.md.skillet-backup', Buffer.from('backup twin', 'utf8'));
    const legacyHash = canonicalContentHash(polluted);
    await writeBundleToSkillStore('@alice/test-skill', polluted);
    const skillDir = join(TEST_ROOT, '.skillet', 'skills', '@alice', 'test-skill');
    await writeFile(join(skillDir, 'SKILL.md.skillet-backup'), Buffer.from('backup twin', 'utf8'));
    expect(await skillStoreMatchesExpectedHash('@alice/test-skill', legacyHash)).toBe(true);
    expect(await skillStoreMatchesExpectedHash('@alice/test-skill', skillContentHash(bundle))).toBe(
      true,
    );
  });
});
