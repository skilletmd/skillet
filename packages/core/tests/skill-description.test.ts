import { describe, it, expect } from 'vitest';
import { resolveSkillDescription } from '../src/kit/skill-description.js';

describe('resolveSkillDescription', () => {
  it('prefers frontmatter description', () => {
    expect(
      resolveSkillDescription({
        frontmatterDescription: 'from frontmatter',
        optsDescription: 'from entry',
        body: 'body line',
        slug: 'my-skill',
      }),
    ).toEqual({ description: 'from frontmatter', source: 'frontmatter' });
  });

  it('falls back to entry description', () => {
    expect(
      resolveSkillDescription({
        optsDescription: 'from entry',
        body: 'body line',
        slug: 'my-skill',
      }),
    ).toEqual({ description: 'from entry', source: 'entry' });
  });

  it('falls back to the first body line without heading markers', () => {
    expect(
      resolveSkillDescription({
        body: '# edited by the user locally\n',
        slug: 'bob-edited',
      }),
    ).toEqual({ description: 'edited by the user locally', source: 'body' });
  });

  it('falls back to slug as last resort', () => {
    expect(
      resolveSkillDescription({
        body: '\n\n',
        slug: 'bob-edited',
      }),
    ).toEqual({ description: 'bob-edited', source: 'slug' });
  });
});
