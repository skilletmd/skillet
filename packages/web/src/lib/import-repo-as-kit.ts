import {
  discoverSkillsFromUrl,
  importDiscoveredSkill,
  importRepoAsUnifiedSkill,
  type DiscoveredSkill,
  type SkillDiscoveryResult,
} from './skill-import'
import { publishSkillFromBrowser } from './skill-studio-client'
import { skillMdFromBundle } from './skill-bundle'
import { skillMarkdownMetadata, slugifySkillName } from './skill-md-metadata'
import { registryAuthApi } from './registry-proxy'

export interface ImportRepoAsKitInput {
  /** The viewer's handle — the sharer-of-record for every imported skill. */
  author: string
  discovery: SkillDiscoveryResult
  /** The subset of discovered skills the user chose to import. */
  selected: DiscoveredSkill[]
  kitName: string
  visibility: 'private' | 'public'
  /** Bundle >1 skill into a kit (default true); false publishes them loose. */
  bundle?: boolean
  onProgress?: (event: ImportProgress) => void
}

export interface ImportProgress {
  label: string
  index: number
  total: number
  status: 'publishing' | 'published' | 'failed'
  error?: string
}

export interface ImportRepoAsKitResult {
  kitId: string | null
  published: { author: string; slug: string }[]
  failed: { label: string; error: string }[]
}

function skillLabel(skill: DiscoveredSkill): string {
  return skill.name || skill.dir || 'skill'
}

/** The `owner/repo` an import came from — the directory's mirror match key. */
function sourceRepoOf(d: SkillDiscoveryResult): string {
  return `${d.owner}/${d.repo}`
}

/** The specific GitHub source directory for one imported skill (falls back to the
 *  repo tree at `ref` when the skill sits at the repo root). Used for provenance
 *  display and precise dedupe. */
function sourceUrlOf(d: SkillDiscoveryResult, dir: string): string {
  const base = `https://github.com/${d.owner}/${d.repo}/tree/${d.ref}`
  return dir ? `${base}/${dir}` : base
}

/**
 * Bulk-import a GitHub repo as one kit: publish (sign) each selected skill under
 * the viewer's handle, then create a linked kit recording the source repo and
 * link every published skill into it. Repo -> Skillet only (resync IN); Skillet stays
 * the canonical signed/scanned artifact.
 */
export async function importRepoAsKit(input: ImportRepoAsKitInput): Promise<ImportRepoAsKitResult> {
  const { author, discovery, selected, kitName, visibility, bundle = true, onProgress } = input
  const published: { author: string; slug: string }[] = []
  const failed: { label: string; error: string }[] = []
  const seenSlugs = new Set<string>()

  for (let i = 0; i < selected.length; i++) {
    const skill = selected[i]!
    const label = skillLabel(skill)
    onProgress?.({ label, index: i, total: selected.length, status: 'publishing' })
    try {
      const bundle = await importDiscoveredSkill(discovery, skill)
      const meta = skillMarkdownMetadata(skillMdFromBundle(bundle.files))
      const slug = slugifySkillName(meta.name ?? skill.name ?? skill.dir)
      if (!slug) throw new Error('Skill is missing a name in its SKILL.md frontmatter.')
      if (seenSlugs.has(slug)) {
        throw new Error(`Duplicate skill name "${slug}" in this repo; rename one and re-import.`)
      }
      seenSlugs.add(slug)
      await publishSkillFromBrowser({
        author,
        slug,
        files: bundle.files,
        visibility,
        baseHash: null,
        sourceRepo: sourceRepoOf(discovery),
        sourceUrl: sourceUrlOf(discovery, skill.dir),
      })
      published.push({ author, slug })
      onProgress?.({ label, index: i, total: selected.length, status: 'published' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed.'
      failed.push({ label, error: message })
      onProgress?.({ label, index: i, total: selected.length, status: 'failed', error: message })
    }
  }

  // A repo = a kit only when it has >1 skill AND the user kept bundling on. One
  // skill, or "bundle off", publishes loose with no kit — matching the sync side.
  if (published.length <= 1 || !bundle) {
    return { kitId: null, published, failed }
  }

  // Create the linked kit, recording the source so it can be re-pulled later.
  const kitRes = await fetch(registryAuthApi('kits'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      name: kitName.trim() || `${discovery.repo}`,
      // Own the kit by whoever the skills published under (you or a team) — the
      // registry authorizes a team owner via canAdminOrgAuthor.
      owner: author,
      visibility,
      source: {
        repo: `${discovery.owner}/${discovery.repo}`,
        ref: discovery.ref,
        path: null,
        sha: discovery.ref,
        // A one-time import is an OWNED kit recording its origin — not a live
        // mirror. That keeps it editable AND lets the registry reuse it on a
        // repeat import (so adding a skill later doesn't collide on the name).
        live: false,
      },
    }),
  })
  if (!kitRes.ok) {
    throw new Error(`Skills imported, but the kit could not be created (${kitRes.status}).`)
  }
  const kit = (await kitRes.json()) as { id: string }

  // Link every published skill into the kit. The membership insert is idempotent
  // (ON CONFLICT), so re-importing to add a skill is safe — existing members are
  // no-ops and only the new ones land. Surface a genuine link failure.
  for (const ref of published) {
    const linkRes = await fetch(registryAuthApi(`kits/${kit.id}/skills`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(ref),
    })
    if (!linkRes.ok) {
      failed.push({
        label: ref.slug,
        error: `Published, but couldn't add to the kit (${linkRes.status}).`,
      })
    }
  }

  return { kitId: kit.id, published, failed }
}

export interface ImportRepoAsUnifiedInput {
  author: string
  discovery: SkillDiscoveryResult
  /** Name for the single skill (defaults to the repo's humanized slug). */
  skillName: string
  visibility: 'private' | 'public'
  onProgress?: (event: ImportProgress) => void
}

/**
 * Import a coupled repo as ONE skill: bundle the whole subtree (so the skills'
 * `../` references resolve), then publish it under the viewer's handle. No kit —
 * a unified import is a single skill. Mirrors importRepoAsKit's result shape so
 * the wizard's done-state handles both paths uniformly.
 */
export async function importRepoAsUnifiedSkillPublished(
  input: ImportRepoAsUnifiedInput,
): Promise<ImportRepoAsKitResult> {
  const { author, discovery, skillName, visibility, onProgress } = input
  const label = skillName.trim() || discovery.repo
  onProgress?.({ label, index: 0, total: 1, status: 'publishing' })
  try {
    const bundle = await importRepoAsUnifiedSkill(discovery)
    const meta = skillMarkdownMetadata(skillMdFromBundle(bundle.files))
    const slug = slugifySkillName(meta.name ?? skillName ?? discovery.repo)
    if (!slug) throw new Error('Could not derive a skill name from the repo.')
    await publishSkillFromBrowser({
      author,
      slug,
      files: bundle.files,
      visibility,
      baseHash: null,
      // A unified import is the whole scoped subtree as one skill, so its source
      // is the prefix dir (or the repo tree at ref when unscoped).
      sourceRepo: sourceRepoOf(discovery),
      sourceUrl: sourceUrlOf(discovery, discovery.prefix),
    })
    onProgress?.({ label, index: 0, total: 1, status: 'published' })
    return { kitId: null, published: [{ author, slug }], failed: [] }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed.'
    onProgress?.({ label, index: 0, total: 1, status: 'failed', error: message })
    return { kitId: null, published: [], failed: [{ label, error: message }] }
  }
}

export interface KitSourceRef {
  repo: string
  ref: string | null
  path: string | null
}

export interface PullKitInput {
  author: string
  kitId: string
  source: KitSourceRef
  /** The kit's visibility — re-published skills follow it. */
  visibility: 'private' | 'public'
  /** Slugs already in the kit, to tell "updated" from "added". */
  existingSlugs: Set<string>
  onProgress?: (event: ImportProgress) => void
}

export interface PullKitResult {
  added: { author: string; slug: string }[]
  updated: { author: string; slug: string }[]
  unchanged: number
  failed: { label: string; error: string }[]
  syncedSha: string | null
}

function sourceToInput(source: KitSourceRef): string {
  if (source.ref || source.path) {
    return `https://github.com/${source.repo}/tree/${source.ref || 'HEAD'}${source.path ? `/${source.path}` : ''}`
  }
  return source.repo
}

/**
 * Re-pull a linked kit from its source repo (resync IN). Re-imports every skill,
 * republishes (the registry dedups unchanged content by hash, so only real edits
 * mint a new version), links any new skills, and records the synced commit.
 * Author-triggered; nothing lands on subscribers automatically.
 */
export async function pullKitFromSource(input: PullKitInput): Promise<PullKitResult> {
  const { author, kitId, source, visibility, existingSlugs, onProgress } = input
  const added: { author: string; slug: string }[] = []
  const updated: { author: string; slug: string }[] = []
  const failed: { label: string; error: string }[] = []
  let unchanged = 0

  const discovery = await discoverSkillsFromUrl(sourceToInput(source))

  for (let i = 0; i < discovery.skills.length; i++) {
    const skill = discovery.skills[i]!
    const label = skillLabel(skill)
    onProgress?.({ label, index: i, total: discovery.skills.length, status: 'publishing' })
    try {
      const bundle = await importDiscoveredSkill(discovery, skill)
      const meta = skillMarkdownMetadata(skillMdFromBundle(bundle.files))
      const slug = slugifySkillName(meta.name ?? skill.name ?? skill.dir)
      if (!slug) throw new Error('Skill is missing a name in its SKILL.md frontmatter.')
      const res = await publishSkillFromBrowser({
        author,
        slug,
        files: bundle.files,
        visibility,
        baseHash: null,
      })
      const ref = { author, slug }
      const wasInKit = existingSlugs.has(slug)
      if (res.already_exists) unchanged++
      else if (wasInKit) updated.push(ref)
      else added.push(ref)
      if (!wasInKit) {
        await fetch(registryAuthApi(`kits/${kitId}/skills`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(ref),
        })
      }
      onProgress?.({ label, index: i, total: discovery.skills.length, status: 'published' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pull failed.'
      failed.push({ label, error: message })
      onProgress?.({
        label,
        index: i,
        total: discovery.skills.length,
        status: 'failed',
        error: message,
      })
    }
  }

  // Record the commit we synced to.
  await fetch(registryAuthApi(`kits/${kitId}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ synced_sha: discovery.ref }),
  })

  return { added, updated, unchanged, failed, syncedSha: discovery.ref }
}
