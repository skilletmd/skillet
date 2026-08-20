/**
 * The closed skill taxonomy — the classifier's label set and the valid values
 * for the `?category=` browse filter. Keep in sync with the web's
 * packages/web/src/lib/categories.ts (labels/colors live there; the registry
 * only needs the keys).
 */
export const CATEGORY_KEYS = [
  'frontend',
  'mobile',
  'backend',
  'database',
  'devops',
  'security',
  'quality',
  'agents',
  'design',
  'product',
  'writing',
  'marketing',
  'sales',
  'finance',
  'productivity',
  'media',
  'research',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/**
 * One-line blurb per category, fed to the classifier so it disambiguates on
 * meaning rather than guessing from the bare key (e.g. `database` is really
 * "Data": SQL/analytics; `agents` includes prompt + skill authoring). Keep in
 * sync with the `blurb` fields in packages/web/src/lib/categories.ts.
 */
export const CATEGORY_BLURBS: Record<CategoryKey, string> = {
  frontend: 'React, components, Next.js, browser UI.',
  mobile: 'iOS, Android, React Native, Expo.',
  backend: 'Services, endpoints, auth, integrations.',
  database: 'Data: SQL, schemas, migrations, analytics, pipelines.',
  devops: 'Deploy, CI/CD, containers, incidents.',
  security: 'Audits, threat modeling, secrets, compliance, bot protection, CAPTCHA.',
  quality: 'Code review, testing, standards, and coverage — correctness across any stack.',
  agents: 'Building with LLMs: agents, RAG, prompts, evals, and skill authoring.',
  design: 'Visual design, image generation, critique, design tokens, prototyping.',
  product: 'Roadmaps, PRDs, prioritization, and launch planning.',
  writing: 'Long-form, scripts, editing, docs, and technical writing — craft, not campaigns.',
  marketing: 'Social posts, blog posts, copy, email, SEO, ads, and campaigns.',
  sales: 'Outbound, cold email, discovery, account research, CRM. 1:1 selling, not brand marketing.',
  finance: 'Modeling, accounting, invoicing, fintech.',
  productivity: 'Email, calendar, notes, meetings, and personal automation.',
  media: 'Video generation and editing, motion graphics, music, and audio.',
  research: 'Deep research, web research, market and competitive analysis, synthesis.',
};

export function isCategoryKey(value: string | null | undefined): value is CategoryKey {
  return value != null && (CATEGORY_KEYS as readonly string[]).includes(value);
}

/**
 * Parse the `?category=` browse filter into valid keys. Accepts a single key or
 * a comma-separated list (a section landing like /browse/creative sends all of
 * its categories at once). Unknown values are dropped, order preserved, deduped
 * — so a bad key never widens the query, it just doesn't filter.
 */
export function parseCategoryFilter(value: string | null | undefined): CategoryKey[] {
  if (!value) return [];
  const seen = new Set<CategoryKey>();
  for (const part of value.split(',')) {
    const key = part.trim();
    if (isCategoryKey(key)) seen.add(key);
  }
  return [...seen];
}
