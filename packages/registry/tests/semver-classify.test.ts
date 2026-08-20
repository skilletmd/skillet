import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPublishDiff,
  nextVersionLabel,
  type VersionFileMap,
} from '../src/semver-classify.js';

function skillMd(frontmatter: string, body = '# Skill\n\nDo the thing.\n'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function files(entries: Record<string, string>): VersionFileMap {
  return new Map(Object.entries(entries));
}

const BASE_FM = 'name: deploy\ndescription: Deploy stuff safely.';
const BASE_MD = skillMd(BASE_FM);
const BASE_FILES = files({ 'SKILL.md': 'skill-v1', 'reference.md': 'ref-v1' });

describe('semver classify — file-set changes (major)', () => {
  it('file added → major', () => {
    const next = files({ 'SKILL.md': 'skill-v1', 'reference.md': 'ref-v1', 'extra.md': 'x1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, BASE_MD), 'major');
  });

  it('file removed → major', () => {
    const next = files({ 'SKILL.md': 'skill-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, BASE_MD), 'major');
  });

  it('file added AND SKILL.md body edited → major (precedence)', () => {
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1', 'extra.md': 'x1' });
    const edited = skillMd(BASE_FM, '# Skill\n\nDo the other thing.\n');
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'major');
  });
});

describe('semver classify — content changes (minor)', () => {
  it('SKILL.md body edited → minor', () => {
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    const edited = skillMd(BASE_FM, '# Skill\n\nDo the other thing.\n');
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'minor');
  });

  it('reference file edited → minor', () => {
    const next = files({ 'SKILL.md': 'skill-v1', 'reference.md': 'ref-v2' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, BASE_MD), 'minor');
  });

  it('description + body change → minor', () => {
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    const edited = skillMd(
      'name: deploy\ndescription: Deploy stuff very safely.',
      '# Skill\n\nDo the other thing.\n',
    );
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'minor');
  });

  it('triggers list changed → minor', () => {
    const base = skillMd(`${BASE_FM}\ntriggers:\n  - before a release`);
    const edited = skillMd(`${BASE_FM}\ntriggers:\n  - before a release\n  - after a rollback`);
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, base, edited), 'minor');
  });

  it('disable-model-invocation flag changed → minor', () => {
    const edited = skillMd(`${BASE_FM}\ndisable-model-invocation: true`);
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'minor');
  });

  it('edit to a body line starting with description: → minor', () => {
    const base = skillMd(BASE_FM, 'description: this line lives in the body\n');
    const edited = skillMd(BASE_FM, 'description: this body line was edited\n');
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, base, edited), 'minor');
  });

  it('unreadable previous SKILL.md → minor', () => {
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, null, BASE_MD), 'minor');
  });
});

describe('semver classify — description-only changes (patch)', () => {
  it('single-line description change → patch', () => {
    const edited = skillMd('name: deploy\ndescription: Deploy stuff very safely.');
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'patch');
  });

  it('folded (>-) multi-line description edit → patch', () => {
    const base = skillMd('name: deploy\ndescription: >-\n  Deploy stuff\n  safely.\ntriggers:\n  - before a release');
    const edited = skillMd('name: deploy\ndescription: >-\n  Deploy stuff very\n  safely, always,\n  with checks.\ntriggers:\n  - before a release');
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, base, edited), 'patch');
  });

  it('literal (|) multi-line description edit → patch', () => {
    const base = skillMd('name: deploy\ndescription: |\n  Deploy stuff\n  safely.');
    const edited = skillMd('name: deploy\ndescription: |\n  Deploy stuff very safely.');
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, base, edited), 'patch');
  });

  it('single-line description grown to a folded block → patch', () => {
    const edited = skillMd('name: deploy\ndescription: >-\n  Deploy stuff safely,\n  every single time.');
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    assert.equal(classifyPublishDiff(BASE_FILES, next, BASE_MD, edited), 'patch');
  });
});

describe('semver classify — version labels', () => {
  it('first publish (no version rows) → 1.0.0', () => {
    assert.deepEqual(nextVersionLabel('minor', null), { major: 1, minor: 0, patch: 0 });
  });

  it('body-only edit with max label (7,0,0) → 7.1.0', () => {
    const next = files({ 'SKILL.md': 'skill-v2', 'reference.md': 'ref-v1' });
    const edited = skillMd(BASE_FM, '# Skill\n\nDo the other thing.\n');
    const kind = classifyPublishDiff(BASE_FILES, next, BASE_MD, edited);
    assert.equal(kind, 'minor');
    assert.deepEqual(nextVersionLabel(kind, { major: 7, minor: 0, patch: 0 }), {
      major: 7,
      minor: 1,
      patch: 0,
    });
  });

  it('yank scenario: bumps over the max label (3,0,0) even when the base row differs', () => {
    assert.deepEqual(nextVersionLabel('minor', { major: 3, minor: 0, patch: 0 }), {
      major: 3,
      minor: 1,
      patch: 0,
    });
  });

  it('major resets minor and patch', () => {
    assert.deepEqual(nextVersionLabel('major', { major: 2, minor: 4, patch: 7 }), {
      major: 3,
      minor: 0,
      patch: 0,
    });
  });

  it('patch bumps only patch', () => {
    assert.deepEqual(nextVersionLabel('patch', { major: 2, minor: 4, patch: 7 }), {
      major: 2,
      minor: 4,
      patch: 8,
    });
  });
});
