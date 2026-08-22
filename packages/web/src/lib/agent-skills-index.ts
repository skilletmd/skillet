import 'server-only'

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

/**
 * The Agent Skills discovery index served at `/.well-known/agent-skills/`.
 *
 * Follows the Cloudflare-authored draft "Agent Skills Discovery via Well-Known
 * URIs" v0.2.0: an index at `/.well-known/agent-skills/index.json` carrying
 * `$schema` plus a `skills` array, each entry with `name`, `type`, `description`,
 * `url`, and a `sha256:` digest of the artifact at that URL. Clients verify the
 * digest before loading, so it has to be the hash of the exact bytes we serve.
 *
 * What this publishes: the skills SKILLET ITSELF ships — the ones in the repo's
 * top-level `skills/` directory. It is deliberately not the public catalog. The
 * question the well-known URI answers is "what skills does skillet.md publish",
 * and answering it with 1,100 third-party skills would be a category error (and
 * a 40 MB index). The catalog has its own discovery surface: the API and
 * `/llms.txt`.
 *
 * Every skill here is a single `SKILL.md`, so every entry is `type: "skill-md"`.
 */

/** Repo-root `skills/`, resolved from the web package's cwd. */
const SKILLS_DIR = path.join(process.cwd(), '..', '..', 'skills')

export const AGENT_SKILLS_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

/** Name grammar from the Agent Skills spec: 1-64 chars, lowercase alphanumerics
 *  and single interior hyphens. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface PublishedSkill {
  name: string
  description: string
  /** Raw SKILL.md bytes, exactly as served. */
  content: string
  /** `sha256:<64 lowercase hex>` over `content`. */
  digest: string
}

function isPublishableName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && SKILL_NAME_RE.test(name)
}

function readSkill(dir: string): PublishedSkill | null {
  const file = path.join(SKILLS_DIR, dir, 'SKILL.md')
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  let data: Record<string, unknown>
  try {
    data = matter(raw).data as Record<string, unknown>
  } catch {
    return null
  }
  // The directory name is the address; the frontmatter name must agree with it
  // or a client would fetch one skill and load another.
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (name !== dir || !isPublishableName(name)) return null
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (!description) return null
  return {
    name,
    // The spec caps descriptions at 1024 characters.
    description: description.slice(0, 1024),
    content: raw,
    digest: `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`,
  }
}

/** Every publishable skill, name-sorted so the index is byte-stable. */
export function listPublishedSkills(): PublishedSkill[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  } catch {
    // A deployment without the repo's `skills/` directory publishes an empty
    // index rather than a 500 — an empty list is a valid answer to "what do
    // you publish".
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && isPublishableName(e.name))
    .map((e) => readSkill(e.name))
    .filter((s): s is PublishedSkill => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One skill by name, or null. */
export function getPublishedSkill(name: string): PublishedSkill | null {
  if (!isPublishableName(name)) return null
  return readSkill(name)
}

/** The v0.2.0 discovery index document. */
export function agentSkillsIndex(): {
  $schema: string
  skills: Array<{ name: string; type: 'skill-md'; description: string; url: string; digest: string }>
} {
  return {
    $schema: AGENT_SKILLS_SCHEMA,
    skills: listPublishedSkills().map((skill) => ({
      name: skill.name,
      type: 'skill-md' as const,
      description: skill.description,
      // Path-absolute, resolved against the index origin per RFC 3986 §5.
      url: `/.well-known/agent-skills/${skill.name}/SKILL.md`,
      digest: skill.digest,
    })),
  }
}
