import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFrontmatterYaml,
  parseTriggersListFromYaml,
  extractTriggersFromSkillMd,
  parseBooleanFlagFromYaml,
  parseNameFromYaml,
  deriveInvocationFacts,
  descriptionSpanInSkillMd,
  resolveInvocationFacts,
} from '../src/skill-frontmatter.js';

function skillBundle(frontmatter: string): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['SKILL.md', Buffer.from(`---\n${frontmatter}\n---\n# Skill\n`)],
  ]);
}

describe('skill frontmatter — name', () => {
  it('parseNameFromYaml uses the last top-level name key', () => {
    const yaml = extractFrontmatterYaml(`---
name: visible
name: hidden
---
`)!;
    assert.equal(parseNameFromYaml(yaml), 'hidden');
  });

  it('extractFrontmatterYaml strips a UTF-8 BOM', () => {
    const yaml = extractFrontmatterYaml('\uFEFF---\nname: bom-skill\n---\n')!;
    assert.equal(parseNameFromYaml(yaml), 'bom-skill');
  });
});

describe('skill frontmatter — triggers', () => {
  it('extracts triggers from SKILL.md frontmatter', () => {
    const bundle = new Map<string, Uint8Array>([
      [
        'SKILL.md',
        Buffer.from(`---
name: deploy
description: Deploy stuff.
triggers:
  - user asks about production deploy
  - "before opening a release PR"
---
# Deploy
`),
      ],
    ]);
    assert.deepEqual(extractTriggersFromSkillMd(bundle), [
      'user asks about production deploy',
      'before opening a release PR',
    ]);
  });

  it('returns empty when triggers absent', () => {
    const bundle = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('---\nname: x\ndescription: y\n---\n')],
    ]);
    assert.deepEqual(extractTriggersFromSkillMd(bundle), []);
  });

  it('parseTriggersListFromYaml handles quoted items', () => {
    const yaml = extractFrontmatterYaml(`---
triggers:
  - 'single quoted'
  - "double quoted"
---
`)!;
    assert.deepEqual(parseTriggersListFromYaml(yaml), [
      'single quoted',
      'double quoted',
    ]);
  });
});

describe('skill frontmatter — description span', () => {
  it('spans a single-line description', () => {
    const text = '---\nname: x\ndescription: does things\ntriggers:\n  - a\n---\n# Body\n';
    assert.deepEqual(descriptionSpanInSkillMd(text), { start: 2, end: 2 });
  });

  it('spans a folded (>-) block scalar through its continuation lines', () => {
    const text = '---\nname: x\ndescription: >-\n  line one\n  line two\ntriggers:\n  - a\n---\n';
    assert.deepEqual(descriptionSpanInSkillMd(text), { start: 2, end: 4 });
  });

  it('spans a literal (|) block scalar', () => {
    const text = '---\ndescription: |\n  line one\n  line two\n---\n';
    assert.deepEqual(descriptionSpanInSkillMd(text), { start: 1, end: 3 });
  });

  it('includes interior blank lines but not trailing ones', () => {
    const text = '---\ndescription: >\n  para one\n\n  para two\n\nname: x\n---\n';
    assert.deepEqual(descriptionSpanInSkillMd(text), { start: 1, end: 4 });
  });

  it('stops at the closing --- so continuation never leaks into the body', () => {
    const text = '---\nname: x\ndescription: >-\n  wrapped\n---\n  indented body line\n';
    assert.deepEqual(descriptionSpanInSkillMd(text), { start: 2, end: 3 });
  });

  it('never matches a body line starting with description:', () => {
    const text = '---\nname: x\n---\ndescription: not frontmatter\n';
    assert.equal(descriptionSpanInSkillMd(text), null);
  });

  it('returns null without frontmatter or without a description key', () => {
    assert.equal(descriptionSpanInSkillMd('# just a body\n'), null);
    assert.equal(descriptionSpanInSkillMd('---\nname: x\n---\n'), null);
  });

  it('handles a UTF-8 BOM and CRLF opener', () => {
    assert.deepEqual(descriptionSpanInSkillMd('\uFEFF---\ndescription: d\n---\n'), {
      start: 1,
      end: 1,
    });
    assert.deepEqual(descriptionSpanInSkillMd('---\r\ndescription: d\r\n---\r\n'), {
      start: 1,
      end: 1,
    });
  });
});

describe('skill frontmatter — invocation facts', () => {
  it('defaults to Automatic with no command (name + description only)', () => {
    assert.deepEqual(deriveInvocationFacts(skillBundle('name: x\ndescription: y')), {
      modelInvoked: true,
      hasCommand: false,
    });
  });

  it('user-invocable adds a command but stays automatic', () => {
    assert.deepEqual(
      deriveInvocationFacts(skillBundle('name: x\ndescription: y\nuser-invocable: true')),
      { modelInvoked: true, hasCommand: true },
    );
  });

  it('disable-model-invocation + user-invocable = command only', () => {
    assert.deepEqual(
      deriveInvocationFacts(
        skillBundle('name: x\ndescription: y\ndisable-model-invocation: true\nuser-invocable: true'),
      ),
      { modelInvoked: false, hasCommand: true },
    );
  });

  it('disable-model-invocation alone = manual command (the skills.sh convention)', () => {
    // Most real skills.sh manual skills (e.g. mattpocock's) use this and nothing
    // else: the model can't auto-fire it, so it's reached by name → a command.
    assert.deepEqual(
      deriveInvocationFacts(skillBundle('name: x\ndescription: y\ndisable-model-invocation: true')),
      { modelInvoked: false, hasCommand: true },
    );
  });

  it('a missing description is not model-invoked', () => {
    assert.deepEqual(deriveInvocationFacts(skillBundle('name: x')), {
      modelInvoked: false,
      hasCommand: false,
    });
  });

  it('no description and no command flag = not invokable (genuine misconfig)', () => {
    assert.deepEqual(deriveInvocationFacts(skillBundle('name: x\nfoo: bar')), {
      modelInvoked: false,
      hasCommand: false,
    });
  });

  it('returns all-false when SKILL.md or frontmatter is absent', () => {
    assert.deepEqual(deriveInvocationFacts(new Map()), {
      modelInvoked: false,
      hasCommand: false,
    });
    assert.deepEqual(
      deriveInvocationFacts(new Map([['SKILL.md', Buffer.from('# no frontmatter\n')]])),
      { modelInvoked: false, hasCommand: false },
    );
  });

  it('parseBooleanFlagFromYaml accepts quoted and bare true, rejects others', () => {
    assert.equal(parseBooleanFlagFromYaml('user-invocable: true', 'user-invocable'), true);
    assert.equal(parseBooleanFlagFromYaml('user-invocable: "true"', 'user-invocable'), true);
    assert.equal(parseBooleanFlagFromYaml('user-invocable: TRUE', 'user-invocable'), true);
    assert.equal(parseBooleanFlagFromYaml('user-invocable: false', 'user-invocable'), false);
    assert.equal(parseBooleanFlagFromYaml('user-invocable: maybe', 'user-invocable'), false);
    assert.equal(parseBooleanFlagFromYaml('name: x', 'user-invocable'), false);
  });
});

describe('skill frontmatter — resolveInvocationFacts (serve)', () => {
  it('uses stored booleans when present', () => {
    assert.deepEqual(
      resolveInvocationFacts(JSON.stringify({ modelInvoked: false, hasCommand: true }), true),
      { modelInvoked: false, hasCommand: true },
    );
  });

  it('honors a stored false even when a description exists', () => {
    // Distinguishes "read stored value" from "default from description".
    assert.deepEqual(
      resolveInvocationFacts(JSON.stringify({ modelInvoked: false, hasCommand: false }), true),
      { modelInvoked: false, hasCommand: false },
    );
  });

  it('defaults to model-invoked when keys absent and a description exists (legacy)', () => {
    assert.deepEqual(resolveInvocationFacts(JSON.stringify({ eval: 'none' }), true), {
      modelInvoked: true,
      hasCommand: false,
    });
  });

  it('defaults to not-invoked when keys absent and no description', () => {
    assert.deepEqual(resolveInvocationFacts(JSON.stringify({}), false), {
      modelInvoked: false,
      hasCommand: false,
    });
  });

  it('falls back to the default on null or malformed metadata', () => {
    assert.deepEqual(resolveInvocationFacts(null, true), { modelInvoked: true, hasCommand: false });
    assert.deepEqual(resolveInvocationFacts('{not json', true), {
      modelInvoked: true,
      hasCommand: false,
    });
  });

  it('ignores non-boolean stored values, falling back per field', () => {
    assert.deepEqual(
      resolveInvocationFacts(JSON.stringify({ modelInvoked: 'yes', hasCommand: 1 }), true),
      { modelInvoked: true, hasCommand: false },
    );
  });
});
