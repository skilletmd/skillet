import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSkillTokens, TOKEN_METHOD } from '../src/lib/skill-tokens.js';

function skillMd(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe('computeSkillTokens', () => {
  it('counts ambient (name + description) and body separately for a normal SKILL.md', () => {
    const md = skillMd(
      'name: crowd-sniff\ndescription: Detect crowded rooms and suggest a quieter time to meet.',
      '# Crowd Sniff\n\nThis is the body of the skill with several sentences of prose.\n',
    );
    const t = computeSkillTokens(md);
    assert.ok(t.ambient > 0, 'ambient should be positive');
    assert.ok(t.body > t.ambient, 'body should outweigh the small ambient frontmatter');
    assert.equal(t.count, t.ambient + t.body);
    assert.equal(t.method, TOKEN_METHOD);
  });

  it('ambient depends only on name + description, not the body', () => {
    const frontmatter =
      'name: same-skill\ndescription: One fixed description shared by both fixtures.';
    const short = computeSkillTokens(skillMd(frontmatter, '# Short\n'));
    const long = computeSkillTokens(
      skillMd(frontmatter, '# Long\n\n' + 'padding sentence. '.repeat(50)),
    );
    assert.equal(short.ambient, long.ambient, 'same frontmatter yields the same ambient');
    assert.ok(long.body > short.body, 'the longer body has more body tokens');
  });

  it('treats a doc with no frontmatter as all body, ambient 0', () => {
    const t = computeSkillTokens('# Just a heading\n\nNo frontmatter here at all.\n');
    assert.equal(t.ambient, 0);
    assert.ok(t.body > 0);
    assert.equal(t.count, t.body);
  });

  it('returns zeros for an empty string without throwing', () => {
    const t = computeSkillTokens('');
    assert.deepEqual(
      { ambient: t.ambient, body: t.body, count: t.count },
      { ambient: 0, body: 0, count: 0 },
    );
    assert.equal(t.method, TOKEN_METHOD);
  });

  it('counts a multi-line / block-scalar description in full toward ambient', () => {
    const multiline = computeSkillTokens(
      [
        '---',
        'name: big-desc',
        'description: >',
        '  This is a long trigger description that spans several lines and',
        '  must be counted in full toward the ambient tax, never truncated',
        '  to just the first line by a single-line regex.',
        '---',
        '# Body',
        '',
      ].join('\n'),
    )
    const shortDesc = computeSkillTokens(
      '---\nname: big-desc\ndescription: short.\n---\n# Body\n',
    )
    // The long description lives in the frontmatter, so if it were dropped it
    // would vanish from both ambient and body. Its tokens must land in ambient.
    assert.ok(
      multiline.ambient > shortDesc.ambient + 10,
      `multi-line description should inflate ambient (got ${multiline.ambient} vs ${shortDesc.ambient})`,
    )
  })

  it('returns a finite count for code-heavy / non-English bodies', () => {
    const md = skillMd(
      'name: polyglot\ndescription: 다국어 스킬 — handles code and non-English prose.',
      '```ts\nconst x = () => fetch("/api").then(r => r.json());\n```\n日本語の説明もここにあります。\n',
    );
    const t = computeSkillTokens(md);
    assert.ok(Number.isFinite(t.count) && t.count > 0);
    assert.ok(t.ambient > 0, 'non-English description still tokenizes');
  });
});
