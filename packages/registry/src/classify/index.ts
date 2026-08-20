import type { DatabaseSync } from '../db/sqlite-handle.js'
import { CATEGORY_KEYS, CATEGORY_BLURBS, type CategoryKey } from '../categories.js'
import type { PrismaDb } from '../db/prisma-client.js'

// Cheap + fast; classification is a one-token-ish decision, not reasoning.
const MODEL = 'claude-haiku-4-5-20251001'

export interface ClassifyInput {
  slug: string
  description: string | null
  /** SKILL.md content. Truncated before sending. */
  body: string
}

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/**
 * Classify a PUBLIC skill into exactly one taxonomy category via the Anthropic
 * API. Key-optional: with no ANTHROPIC_API_KEY set it returns null (the skill
 * stays uncategorized) so the registry runs fine without it.
 *
 * PRIVACY: only ever call this for public skills. The caller gates on
 * visibility === 'public', so private skill content never leaves the registry.
 */
export async function classifySkill(input: ClassifyInput): Promise<CategoryKey | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const labels = CATEGORY_KEYS.map((k) => `- ${k}: ${CATEGORY_BLURBS[k]}`).join('\n')
  const prompt =
    `You sort AI agent skills into exactly one category.\n` +
    `Allowed categories (use the key verbatim):\n${labels}\n\n` +
    `Skill slug: ${input.slug}\n` +
    `Description: ${input.description ?? ''}\n\n` +
    `SKILL.md:\n${input.body.slice(0, 2000)}\n\n` +
    `Reply with ONLY the single best category key from the list. No other text.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { content?: Array<{ text?: string }> }
    return firstCategoryIn(data.content?.[0]?.text ?? '')
  } catch {
    return null
  }
}

/**
 * Resolve the model's reply to a single category. We ask for one bare key, but
 * Haiku occasionally returns punctuation, a prefix ("Category: frontend"), or
 * two keys ("frontend, design"). Scan the text for the first whole-word match
 * against the taxonomy so those cases land on a real category instead of
 * silently dropping to uncategorized. Returns null only when nothing matches.
 */
export function firstCategoryIn(text: string): CategoryKey | null {
  const haystack = text.toLowerCase()
  let best: { key: CategoryKey; at: number } | null = null
  for (const key of CATEGORY_KEYS) {
    // \b…\b so "design" doesn't match inside "redesign".
    const at = haystack.search(new RegExp(`\\b${key}\\b`))
    if (at !== -1 && (best === null || at < best.at)) best = { key, at }
  }
  return best?.key ?? null
}

/**
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-classify.ts.
 */
export async function classifyAndStore(
  _db: DatabaseSync,
  _skillId: string,
  _input: ClassifyInput,
): Promise<boolean> {
  throw new Error(`${SQLITE_REMOVED}: classifyAndStorePrisma`)
}

/** Prisma counterpart of {@link classifyAndStore}. */
export async function classifyAndStorePrisma(
  prisma: PrismaDb,
  skillId: string,
  input: ClassifyInput,
): Promise<boolean> {
  const category = await classifySkill(input)
  if (!category) return false
  try {
    await prisma.skills.update({
      where: { id: skillId },
      data: { category },
    })
    return true
  } catch {
    /* skill may have been deleted between publish and classify; ignore */
    return false
  }
}

/**
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-classify.ts.
 */
export function readStoredSkillMd(_db: DatabaseSync, _skillId: string): string {
  throw new Error(`${SQLITE_REMOVED}: readStoredSkillMdPrisma`)
}

/** Prisma counterpart of {@link readStoredSkillMd}. */
export async function readStoredSkillMdPrisma(prisma: PrismaDb, skillId: string): Promise<string> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { latest_hash: true },
  })
  if (!skill?.latest_hash) return ''
  const bare = skill.latest_hash.startsWith('sha256:')
    ? skill.latest_hash.slice('sha256:'.length)
    : skill.latest_hash
  const row = await prisma.skill_version_files.findFirst({
    where: {
      skill_id: skillId,
      path: 'SKILL.md',
      version_hash: { in: [bare, `sha256:${bare}`] },
    },
    select: { blobs: { select: { bytes: true } } },
  })
  const bytes = row?.blobs?.bytes
  if (!bytes || bytes.byteLength === 0) return ''
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-classify.ts.
 */
export async function classifyUncategorizedSkills(
  _db: DatabaseSync,
  _rows: Array<{ id: string; slug: string; description: string | null }>,
): Promise<number> {
  throw new Error(`${SQLITE_REMOVED}: classifyUncategorizedSkillsPrisma`)
}

/** Prisma counterpart of {@link classifyUncategorizedSkills}. */
export async function classifyUncategorizedSkillsPrisma(
  prisma: PrismaDb,
  rows: Array<{ id: string; slug: string; description: string | null }>,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || rows.length === 0) return 0
  let classified = 0
  for (const row of rows) {
    const current = await prisma.skills.findUnique({
      where: { id: row.id },
      select: { category: true },
    })
    if (!current || current.category != null) continue
    const body = await readStoredSkillMdPrisma(prisma, row.id)
    const stored = await classifyAndStorePrisma(prisma, row.id, {
      slug: row.slug,
      description: row.description,
      body,
    })
    if (stored) classified++
  }
  return classified
}
