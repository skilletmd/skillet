import {
  classifyImport,
  dedupeMirrorsBy,
  isCoupledSkillMarkdown,
  isExcludedDiscoveryPath,
  type ImportClassification,
  type ImportMode,
} from '@skillet/protocol'
import { entryFromBytes, entryFromText, isJunkPath, type BundleFiles } from './skill-bundle'
import { skillMarkdownMetadata } from './skill-md-metadata'

// Re-export the shared classification rules so existing importers/tests keep
// their import paths. The decisions live in @skillet/protocol (one source of
// truth shared with the registry sync engine).
export { isExcludedDiscoveryPath }
export type { ImportClassification, ImportMode }

export interface SkillImportResult {
  markdown: string
  source: string
}

export interface SkillBundleImportResult {
  files: BundleFiles
  source: string
}

/** Cap on files pulled from a single repo import, to avoid runaway fetches. */
const MAX_IMPORT_FILES = 200

type FetchLike = typeof fetch

interface GitHubRepoTarget {
  owner: string
  repo: string
  ref?: string
  prefix?: string
}

interface GitHubTreeEntry {
  path?: string
  type?: string
}

interface GitHubTreeResponse {
  sha?: string
  tree?: GitHubTreeEntry[]
}

function assertOk(response: Response, label: string) {
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}.`)
  }
}

function pathBaseName(path: string) {
  return path.split('/').pop()?.toLowerCase() ?? ''
}

export function githubBlobUrlToRaw(input: string): string | null {
  const url = new URL(input)

  if (url.hostname === 'raw.githubusercontent.com') {
    return url.toString()
  }

  if (url.hostname !== 'github.com') return null

  const parts = url.pathname.split('/').filter(Boolean)
  const blobIndex = parts.indexOf('blob')
  if (parts.length < 5 || blobIndex !== 2) return null

  const [owner, repo] = parts
  const ref = parts[3]
  const filePath = parts.slice(4).join('/')
  if (!owner || !repo || !ref || !filePath) return null

  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`
}

export function githubRepoTarget(input: string): GitHubRepoTarget | null {
  const url = new URL(input)
  if (url.hostname !== 'github.com') return null

  const parts = url.pathname.split('/').filter(Boolean)
  const [owner, repo] = parts
  if (!owner || !repo) return null

  const treeIndex = parts.indexOf('tree')
  if (treeIndex === 2 && parts[3]) {
    return {
      owner,
      repo,
      ref: parts[3],
      prefix: parts.slice(4).join('/'),
    }
  }

  if (parts.length === 2) {
    return { owner, repo }
  }

  return null
}

/**
 * Normalize any skill *reference* to a canonical GitHub URL the readers below
 * already understand. A skill reference can be:
 *   - a github.com or raw.githubusercontent.com URL (passed through)
 *   - a skills.sh link (skills.sh only indexes GitHub, so skills.sh/<owner>/<repo>
 *     resolves to that repo)
 *   - an install command: `npx skills add <owner>/<repo>`, `skills add …`
 *   - a bare `<owner>/<repo>` (optionally `<owner>/<repo>/<sub/dir>`)
 * Returns null when the input matches none of these, so callers can show a
 * single helpful "what we accept" error. Pure and synchronous.
 *
 * NOTE: named `normalizeGithubSkillUrl` (not `resolveSkillRef`) so it can never
 * be confused with the registry's `resolveSkillRef` (a DB/alias resolver of a
 * completely different shape) — the two once shared a name with divergent
 * behavior.
 */
export function normalizeGithubSkillUrl(input: string): string | null {
  let ref = input.trim()
  if (!ref) return null

  // Strip a leading install command (npx/skills/cli add|install); the ref is its
  // last argument. Run twice so `npx skills add X` (two tokens) fully unwraps.
  for (let i = 0; i < 2; i++) {
    ref = ref
      .replace(/^npx\s+(?:--yes\s+|-y\s+)?/i, '')
      .replace(/^(?:@skillet\/cli|skillet|skills?)\s+(?:add|install|i)\s+/i, '')
      .trim()
  }
  // Strip copy-paste quote/backtick noise.
  ref = ref.replace(/^[`'"]+|[`'"]+$/g, '').trim()
  if (!ref) return null

  // Scheme-less known host (e.g. `github.com/owner/repo/tree/main/...`). Without
  // this, such a paste falls through to the bare owner/repo branch below and gets
  // mangled into `github.com/<owner>` as the repo. Prepend a scheme so it's parsed
  // as the URL it is.
  if (/^(?:www\.)?(?:github\.com|raw\.githubusercontent\.com|skills\.sh)\//i.test(ref)) {
    ref = `https://${ref}`
  }

  // Already a URL.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    let url: URL
    try {
      url = new URL(ref)
    } catch {
      return null
    }
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'github.com' || host === 'raw.githubusercontent.com') return url.toString()
    if (host === 'skills.sh') {
      const seg = url.pathname.split('/').filter(Boolean)
      if (seg.length >= 2) return `https://github.com/${seg[0]}/${seg[1]}`
    }
    return null
  }

  // Bare owner/repo (+ optional sub/dir). GitHub names allow [A-Za-z0-9._-].
  const match = ref.match(/^([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?:\/(.+))?$/)
  if (match) {
    const owner = match[1]
    const repo = match[2].replace(/\.git$/i, '')
    const sub = match[3]?.replace(/\/+$/g, '')
    return sub
      ? `https://github.com/${owner}/${repo}/tree/HEAD/${sub}`
      : `https://github.com/${owner}/${repo}`
  }

  return null
}

const REF_ERROR = 'Paste a GitHub URL, an "npx skills add owner/repo" command, or just owner/repo.'

async function readTextUrl(url: string, fetchImpl: FetchLike): Promise<SkillImportResult> {
  const response = await fetchImpl(url, {
    headers: { accept: 'text/plain, text/markdown, */*' },
  })
  assertOk(response, 'SKILL.md')
  return { markdown: await response.text(), source: url }
}

async function readGitHubRepo(
  target: GitHubRepoTarget,
  fetchImpl: FetchLike,
): Promise<SkillImportResult> {
  const treeUrl = new URL(
    `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${target.ref ?? 'HEAD'}`,
  )
  treeUrl.searchParams.set('recursive', '1')

  const treeResponse = await fetchImpl(treeUrl.toString(), {
    headers: { accept: 'application/vnd.github+json' },
  })
  assertOk(treeResponse, 'GitHub repository')

  const data = (await treeResponse.json()) as GitHubTreeResponse
  const prefix = target.prefix ? `${target.prefix.replace(/\/+$/g, '')}/` : ''
  const matches = (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path)
    .map((entry) => entry.path as string)
    .filter((path) => pathBaseName(path) === 'skill.md')
    .filter((path) => !prefix || path.startsWith(prefix))
    .sort((a, b) => {
      if (a.toLowerCase() === 'skill.md') return -1
      if (b.toLowerCase() === 'skill.md') return 1
      return a.length - b.length || a.localeCompare(b)
    })

  const skillPath = matches[0]
  if (!skillPath) {
    throw new Error('No SKILL.md found in that GitHub URL.')
  }

  const ref = target.ref ?? data.sha ?? 'HEAD'
  const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${ref}/${skillPath}`
  return readTextUrl(rawUrl, fetchImpl)
}

export async function importSkillMarkdownFromUrl(
  input: string,
  fetchImpl: FetchLike = fetch,
): Promise<SkillImportResult> {
  const url = normalizeGithubSkillUrl(input)
  if (!url) throw new Error(REF_ERROR)

  const rawUrl = githubBlobUrlToRaw(url)
  if (rawUrl) return readTextUrl(rawUrl, fetchImpl)

  const repoTarget = githubRepoTarget(url)
  if (repoTarget) return readGitHubRepo(repoTarget, fetchImpl)

  throw new Error(REF_ERROR)
}

// ---------------------------------------------------------------------------
// Full-folder import — a skill is a folder, not just SKILL.md. We locate the
// SKILL.md, then pull every file in its directory so references/, scripts/, and
// assets/ travel with it.
// ---------------------------------------------------------------------------

function dirNameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Choose the most likely entrypoint SKILL.md from a repo tree (root-first). */
function findSkillMdPath(paths: string[], prefix: string): string | undefined {
  return paths
    .filter((path) => pathBaseName(path) === 'skill.md')
    .filter((path) => !prefix || path.startsWith(prefix))
    .sort((a, b) => {
      if (a.toLowerCase() === 'skill.md') return -1
      if (b.toLowerCase() === 'skill.md') return 1
      return a.length - b.length || a.localeCompare(b)
    })[0]
}

async function readBytesUrl(url: string, fetchImpl: FetchLike): Promise<Uint8Array> {
  const response = await fetchImpl(url, { headers: { accept: '*/*' } })
  assertOk(response, 'file')
  return new Uint8Array(await response.arrayBuffer())
}

async function readGitHubRepoBundle(
  target: GitHubRepoTarget,
  fetchImpl: FetchLike,
): Promise<SkillBundleImportResult> {
  const treeUrl = new URL(
    `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${target.ref ?? 'HEAD'}`,
  )
  treeUrl.searchParams.set('recursive', '1')

  const treeResponse = await fetchImpl(treeUrl.toString(), {
    headers: { accept: 'application/vnd.github+json' },
  })
  assertOk(treeResponse, 'GitHub repository')

  const data = (await treeResponse.json()) as GitHubTreeResponse
  const blobPaths = (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path)
    .map((entry) => entry.path as string)

  const prefix = target.prefix ? `${target.prefix.replace(/\/+$/g, '')}/` : ''
  const skillPath = findSkillMdPath(blobPaths, prefix)
  if (!skillPath) {
    throw new Error('No SKILL.md found in that GitHub URL.')
  }

  const skillDir = dirNameOf(skillPath)
  const dirPrefix = skillDir ? `${skillDir}/` : ''
  const ref = target.ref ?? data.sha ?? 'HEAD'

  const selected = blobPaths
    .filter((path) => (skillDir ? path.startsWith(dirPrefix) : true))
    .filter((path) => !isJunkPath(skillDir ? path.slice(dirPrefix.length) : path))
    .slice(0, MAX_IMPORT_FILES)

  const files: BundleFiles = {}
  for (const path of selected) {
    const rel = skillDir ? path.slice(dirPrefix.length) : path
    if (!rel) continue
    const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${ref}/${path}`
    files[rel] = entryFromBytes(await readBytesUrl(rawUrl, fetchImpl))
  }

  if (!files['SKILL.md']) {
    throw new Error('No SKILL.md found in that GitHub URL.')
  }

  return {
    files,
    source: `github.com/${target.owner}/${target.repo}${skillDir ? `/${skillDir}` : ''}`,
  }
}

/**
 * Import a full skill folder (SKILL.md plus supporting files) from a GitHub URL.
 * A blob/raw URL yields just that single SKILL.md; a repo/tree URL pulls the
 * whole directory the entrypoint lives in.
 */
export async function importSkillBundleFromUrl(
  input: string,
  fetchImpl: FetchLike = fetch,
): Promise<SkillBundleImportResult> {
  const url = normalizeGithubSkillUrl(input)
  if (!url) throw new Error(REF_ERROR)

  const rawUrl = githubBlobUrlToRaw(url)
  if (rawUrl) {
    const { markdown } = await readTextUrl(rawUrl, fetchImpl)
    return { files: { 'SKILL.md': entryFromText(markdown) }, source: rawUrl }
  }

  const repoTarget = githubRepoTarget(url)
  if (repoTarget) return readGitHubRepoBundle(repoTarget, fetchImpl)

  throw new Error(REF_ERROR)
}

// ---------------------------------------------------------------------------
// Multi-skill discovery — a repo can hold many skills in one tree (e.g.
// /skills/seo/SKILL.md, /skills/ads/SKILL.md). We find every SKILL.md, bucket
// each file under its nearest skill dir (so nested/sibling skills don't swallow
// each other), and parse each one's name/description for a picker.
// ---------------------------------------------------------------------------

const SKILL_ENTRY = 'SKILL.md'
const MAX_DISCOVERED_SKILLS = 300

export interface DiscoveredSkill {
  /** POSIX dir containing the SKILL.md; '' for a skill at the repo root. */
  dir: string
  name: string
  description: string
  /**
   * True when this skill's SKILL.md references a path outside its own folder (a
   * `../` segment) — it depends on a sibling skill or a shared dir, so it only
   * resolves when imported together with the rest of the repo.
   */
  coupled: boolean
  /** Repo-relative blob paths that belong to this skill. */
  files: string[]
}

export interface SkillDiscoveryResult {
  owner: string
  repo: string
  ref: string
  /** Repo-relative subtree the discovery was scoped to ('' = whole repo). */
  prefix: string
  source: string
  skills: DiscoveredSkill[]
  /** Total skills found in the repo/subtree before the display cap. */
  total: number
}

/**
 * Recommend how to import a discovered repo, using the shared classifier. The
 * wizard always shows the result and lets the user override.
 */
export function classifyDiscovery(result: SkillDiscoveryResult): ImportClassification {
  return classifyImport(result.skills)
}

function isUnderDir(dir: string, child: string): boolean {
  if (dir === '') return true
  return child === dir || child.startsWith(`${dir}/`)
}

function nearestSkillDir(blobPath: string, dirsDeepestFirst: string[]): string | null {
  for (const dir of dirsDeepestFirst) {
    if (isUnderDir(dir, blobPath)) return dir
  }
  return null
}

/** Map over items with a bounded number of in-flight promises (preserves order). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function fetchRepoTree(
  target: GitHubRepoTarget,
  fetchImpl: FetchLike,
): Promise<{ ref: string; blobPaths: string[] }> {
  const treeUrl = new URL(
    `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${target.ref ?? 'HEAD'}`,
  )
  treeUrl.searchParams.set('recursive', '1')
  const response = await fetchImpl(treeUrl.toString(), {
    headers: { accept: 'application/vnd.github+json' },
  })
  assertOk(response, 'GitHub repository')
  const data = (await response.json()) as GitHubTreeResponse
  const blobPaths = (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path)
    .map((entry) => entry.path as string)
  return { ref: target.ref ?? data.sha ?? 'HEAD', blobPaths }
}

/** Find every skill in a GitHub repo/tree (or a single one for a blob/raw URL). */
export async function discoverSkillsFromUrl(
  input: string,
  fetchImpl: FetchLike = fetch,
): Promise<SkillDiscoveryResult> {
  const canonical = normalizeGithubSkillUrl(input)
  if (!canonical) throw new Error(REF_ERROR)
  const url = new URL(canonical)

  // A blob/raw URL points at one explicit SKILL.md.
  const rawUrl = githubBlobUrlToRaw(url.toString())
  if (rawUrl) {
    const { markdown } = await readTextUrl(rawUrl, fetchImpl)
    const meta = skillMarkdownMetadata(markdown)
    const parts = new URL(rawUrl).pathname.split('/').filter(Boolean)
    const [owner, repo, ref, ...rest] = parts
    const filePath = rest.join('/')
    const dir = dirNameOf(filePath)
    return {
      owner,
      repo,
      ref,
      prefix: dir,
      source: `github.com/${owner}/${repo}${dir ? `/${dir}` : ''}`,
      skills: [
        {
          dir,
          name: meta.name ?? repo,
          description: meta.description ?? '',
          coupled: isCoupledSkillMarkdown(markdown),
          files: [filePath],
        },
      ],
      total: 1,
    }
  }

  const target = githubRepoTarget(url.toString())
  if (!target) throw new Error('Use a GitHub repo, tree, blob, or raw SKILL.md URL.')

  const { ref, blobPaths } = await fetchRepoTree(target, fetchImpl)
  const prefixDir = target.prefix ? target.prefix.replace(/\/+$/g, '') : ''

  let skillDirs = blobPaths
    .filter((path) => pathBaseName(path) === 'skill.md')
    .filter((path) => !isExcludedDiscoveryPath(path))
    .map(dirNameOf)
  if (prefixDir) skillDirs = skillDirs.filter((dir) => isUnderDir(prefixDir, dir))
  const dirsDeepestFirst = [...new Set(skillDirs)].sort((a, b) => b.length - a.length)
  if (dirsDeepestFirst.length === 0) {
    throw new Error('No SKILL.md found in that GitHub URL.')
  }

  const buckets = new Map<string, string[]>()
  for (const dir of dirsDeepestFirst) buckets.set(dir, [])
  for (const path of blobPaths) {
    if (prefixDir && !isUnderDir(prefixDir, path)) continue
    if (isExcludedDiscoveryPath(path)) continue
    const owner = nearestSkillDir(path, dirsDeepestFirst)
    if (owner != null) buckets.get(owner)!.push(path)
  }

  // Alphabetical by path so related skills group by category (skills/analytics,
  // skills/channels, …) and the order is predictable.
  const orderedDirs = [...buckets.keys()]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_DISCOVERED_SKILLS)

  // Read each SKILL.md for its frontmatter name/description, whether it is
  // coupled (references `../`), and its body — bounded so a big repo doesn't
  // fire hundreds of concurrent requests. The body keys mirror-dedup below.
  const found = await mapWithConcurrency(
    orderedDirs,
    16,
    async (dir): Promise<{ skill: DiscoveredSkill; body: string }> => {
      const skillMdPath = dir === '' ? SKILL_ENTRY : `${dir}/${SKILL_ENTRY}`
      let name = dir === '' ? target.repo : (dir.split('/').pop() ?? target.repo)
      let description = ''
      let coupled = false
      let body = ''
      try {
        const fileUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${ref}/${skillMdPath}`
        const { markdown } = await readTextUrl(fileUrl, fetchImpl)
        const meta = skillMarkdownMetadata(markdown)
        if (meta.name) name = meta.name
        if (meta.description) description = meta.description
        coupled = isCoupledSkillMarkdown(markdown)
        body = markdown.trim()
      } catch {
        // Keep the folder-name fallback if the SKILL.md can't be read.
      }
      return { skill: { dir, name, description, coupled, files: buckets.get(dir) ?? [] }, body }
    },
  )

  // Drop mirror copies: two folders with a byte-identical SKILL.md are the same
  // skill re-emitted for another tool (e.g. plugins/<tool>/skills/x mirroring
  // skills/x). Keep the canonical one. Dot-dir mirrors are already excluded
  // above; this catches the rest. Unreadable SKILL.md (empty body) never dedups.
  const skills = dedupeMirrorsBy(
    found,
    (f) => f.skill.dir,
    (f) => f.body || null,
  )
    .map((f) => f.skill)
    .sort((a, b) => a.dir.localeCompare(b.dir))

  return {
    owner: target.owner,
    repo: target.repo,
    ref,
    prefix: prefixDir,
    source: `github.com/${target.owner}/${target.repo}${prefixDir ? `/${prefixDir}` : ''}`,
    skills,
    // Skill dirs found before the display cap (drives the "showing first N"
    // notice). Mirror-dedup shrinks `skills` below this without it being a cap.
    total: buckets.size,
  }
}

/** Download one discovered skill's folder into a bundle (paths relative to its dir). */
export async function importDiscoveredSkill(
  discovery: SkillDiscoveryResult,
  skill: DiscoveredSkill,
  fetchImpl: FetchLike = fetch,
): Promise<SkillBundleImportResult> {
  const dirPrefix = skill.dir ? `${skill.dir}/` : ''
  const selected = skill.files
    .filter((path) => !isJunkPath(skill.dir ? path.slice(dirPrefix.length) : path))
    .slice(0, MAX_IMPORT_FILES)

  const files: BundleFiles = {}
  for (const path of selected) {
    let rel = skill.dir ? path.slice(dirPrefix.length) : path
    if (!rel) continue
    if (rel.toLowerCase() === 'skill.md') rel = SKILL_ENTRY
    const fileUrl = `https://raw.githubusercontent.com/${discovery.owner}/${discovery.repo}/${discovery.ref}/${path}`
    files[rel] = entryFromBytes(await readBytesUrl(fileUrl, fetchImpl))
  }

  if (!files[SKILL_ENTRY]) {
    throw new Error('No SKILL.md found in that skill folder.')
  }

  return {
    files,
    source: `github.com/${discovery.owner}/${discovery.repo}${skill.dir ? `/${skill.dir}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Unified import — for a `unified` repo (coupled skills), the whole repo is one
// skill so a SKILL.md's `../shared/...` references resolve within one bundle. No
// path rewriting, no dependency edges: not splitting the repo is what makes the
// relative paths resolve.
// ---------------------------------------------------------------------------

/** A whole repo can carry more files than a single skill folder. */
const MAX_UNIFIED_FILES = 1500

/** Title-case a slug for a generated heading ("agent-skills" -> "Agent Skills"). */
function titleize(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * A repo may have no SKILL.md at its root (skills live in subfolders). A unified
 * bundle needs one at the root, so synthesize an index that names the bundled
 * skills and points at their folders.
 */
function synthesizeUnifiedIndex(discovery: SkillDiscoveryResult): string {
  const list = discovery.skills
    .map((s) => `- \`${s.dir}/SKILL.md\`${s.description ? ` — ${s.description}` : ''}`)
    .join('\n')
  const frontmatter = `---\nname: ${discovery.repo}\ndescription: ${discovery.skills.length} related skills from ${discovery.owner}/${discovery.repo}, bundled because they share files.\n---`
  return `${frontmatter}\n\n# ${titleize(discovery.repo)}\n\nThis skill bundles ${discovery.skills.length} related skills that reference shared files, so they install and run together. Each lives in its own folder:\n\n${list}\n`
}

/**
 * Import a `unified` repo as one skill: every non-excluded file under the
 * discovered subtree, rerooted so the skills' `../` references resolve, with a
 * synthesized index entrypoint when the root has no SKILL.md.
 */
export async function importRepoAsUnifiedSkill(
  discovery: SkillDiscoveryResult,
  fetchImpl: FetchLike = fetch,
): Promise<SkillBundleImportResult> {
  const target: GitHubRepoTarget = {
    owner: discovery.owner,
    repo: discovery.repo,
    ref: discovery.ref,
    ...(discovery.prefix ? { prefix: discovery.prefix } : {}),
  }
  const { ref, blobPaths } = await fetchRepoTree(target, fetchImpl)
  const rootPrefix = discovery.prefix ? `${discovery.prefix.replace(/\/+$/g, '')}/` : ''

  const selected = blobPaths
    .filter((path) => !rootPrefix || path.startsWith(rootPrefix))
    .map((path) => ({ full: path, rel: rootPrefix ? path.slice(rootPrefix.length) : path }))
    .filter(({ rel }) => rel && !isExcludedDiscoveryPath(rel) && !isJunkPath(rel))
    .slice(0, MAX_UNIFIED_FILES)

  const files: BundleFiles = {}
  for (const { full, rel } of selected) {
    const rawUrl = `https://raw.githubusercontent.com/${discovery.owner}/${discovery.repo}/${ref}/${full}`
    files[rel] = entryFromBytes(await readBytesUrl(rawUrl, fetchImpl))
  }

  if (!files[SKILL_ENTRY]) {
    files[SKILL_ENTRY] = entryFromText(synthesizeUnifiedIndex(discovery))
  }

  return {
    files,
    source: `github.com/${discovery.owner}/${discovery.repo}${discovery.prefix ? `/${discovery.prefix}` : ''}`,
  }
}
