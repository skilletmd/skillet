import { formatSkillRef } from '../registry/identifier.js';

/** Map registry `author:slug` skill_id to canonical `@author/slug`. */
export function skillIdToRef(skillId: string): string {
  const idx = skillId.indexOf(':');
  if (idx <= 0 || idx >= skillId.length - 1) {
    throw new Error(`Invalid skill_id ${JSON.stringify(skillId)}`);
  }
  const author = skillId.slice(0, idx);
  const slug = skillId.slice(idx + 1);
  return formatSkillRef(author, slug);
}

export function kitSkillRefsFromIds(
  skillIds: Array<{ skill_id: string }>,
): string[] {
  return skillIds.map((s) => skillIdToRef(s.skill_id));
}
