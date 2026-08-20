export type SkillDescriptionSource = 'frontmatter' | 'entry' | 'body' | 'slug';

export interface SkillDescriptionResolution {
  description: string;
  source: SkillDescriptionSource;
}

export interface SkillDescriptionResolveInput {
  frontmatterDescription?: string;
  optsDescription?: string;
  body: string;
  slug: string;
}

function firstBodyLine(body: string): string | null {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const withoutHeading = trimmed.replace(/^#+\s*/, '').trim();
    return withoutHeading || trimmed;
  }
  return null;
}

/** Resolve the description Cursor and diagnostics use when SKILL.md omits frontmatter. */
export function resolveSkillDescription(
  input: SkillDescriptionResolveInput,
): SkillDescriptionResolution {
  const fromFrontmatter = input.frontmatterDescription?.trim();
  if (fromFrontmatter) {
    return { description: fromFrontmatter, source: 'frontmatter' };
  }

  const fromEntry = input.optsDescription?.trim();
  if (fromEntry) {
    return { description: fromEntry, source: 'entry' };
  }

  const fromBody = firstBodyLine(input.body);
  if (fromBody) {
    return { description: fromBody, source: 'body' };
  }

  const fromSlug = input.slug.trim();
  if (fromSlug) {
    return { description: fromSlug, source: 'slug' };
  }

  return { description: 'skill', source: 'slug' };
}
