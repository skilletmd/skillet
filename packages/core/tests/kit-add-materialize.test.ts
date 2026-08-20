import { describe, it, expect } from 'vitest';
import {
  kitSkillRefsFromIds,
  skillIdToRef,
} from '../src/commands/kit-add-materialize.js';

describe('kit-add-materialize', () => {
  it('skillIdToRef maps author:slug to @author/slug', () => {
    expect(skillIdToRef('alice:review-a-diff')).toBe('@alice/review-a-diff');
  });

  it('kitSkillRefsFromIds maps kit skill list', () => {
    expect(
      kitSkillRefsFromIds([{ skill_id: 'bob:a' }, { skill_id: 'bob:b' }]),
    ).toEqual(['@bob/a', '@bob/b']);
  });
});
