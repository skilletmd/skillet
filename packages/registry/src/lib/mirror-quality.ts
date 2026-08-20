// Quality gate for mirror discovery candidates.
//
// `assessCandidateQuality` runs AFTER `screenCandidate` passes and decides
// whether a repo is worth a human reviewer's time at all. The screen answers
// "may we legally mirror this?"; this answers "is it plausibly good?". It is
// deterministic and explainable — every point awarded or denied carries a note,
// so the admin queue can show WHY a candidate scored what it did.
//
// The checks mechanize a deterministic skill-quality rubric: real frontmatter,
// a capability-stating description free of marketing words, structured bodies,
// not a router/index skill. Provenance is weighted over raw stars because raw
// star counts are a weak signal in this category; an org account with history
// outranks a week-old account with 900 stars.
//
// Hard fails reject outright; otherwise candidates below `minScore` are
// rejected with the scored notes. GitHub access is via an injectable
// `fetchImpl` (mirrors mirror-screen.ts) so everything is unit-testable.
import { parseFrontmatter } from '../sync/sync-repo.js'

const GH_API = 'https://api.github.com'

/** Sample at most this many SKILL.md files per candidate (bounds API calls). */
const MAX_SKILL_SAMPLES = 5

/** A repo with more skill dirs than this reads as a bulk index, not an authored library. */
export const MAX_PLAUSIBLE_SKILLS = 300

/** Marketing no-ops from the rubric — a description should state a capability. */
const MARKETING_WORDS = /\b(powerful|comprehensive|seamless|advanced|ultimate|revolutionary|best-in-class|cutting-edge|game-chang\w*|supercharge\w*)\b/i

export interface QualityInput {
  owner: string
  repo: string
  token?: string
  fetchImpl?: typeof fetch
}

export interface QualityResult {
  /** 0-100; higher is better. */
  score: number
  /** Non-recoverable defect (dump repo, no real frontmatter) — reject outright. */
  hardFail: string | null
  /** One line per scored component, for the review queue's screen_notes. */
  notes: string[]
  skillCount: number
}

async function ghGet(url: string, input: QualityInput): Promise<Response | null> {
  const f = input.fetchImpl ?? globalThis.fetch
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'skillet-mirror-quality',
    'x-github-api-version': '2022-11-28',
  }
  if (input.token) headers.authorization = `Bearer ${input.token}`
  try {
    return await f(url, { headers, signal: AbortSignal.timeout(10_000) })
  } catch {
    return null
  }
}

interface RepoSignals {
  ownerType: 'User' | 'Organization' | null
  stars: number
  createdAt: string | null
  pushedAt: string | null
  defaultBranch: string
}

async function fetchRepoSignals(input: QualityInput): Promise<RepoSignals | null> {
  const res = await ghGet(`${GH_API}/repos/${input.owner}/${input.repo}`, input)
  if (!res || !res.ok) return null
  const body = (await res.json().catch(() => null)) as {
    owner?: { type?: string }
    stargazers_count?: number
    created_at?: string
    pushed_at?: string
    default_branch?: string
  } | null
  if (!body) return null
  return {
    ownerType:
      body.owner?.type === 'Organization' ? 'Organization' : body.owner?.type === 'User' ? 'User' : null,
    stars: typeof body.stargazers_count === 'number' ? body.stargazers_count : 0,
    createdAt: body.created_at ?? null,
    pushedAt: body.pushed_at ?? null,
    defaultBranch: body.default_branch ?? 'main',
  }
}

async function fetchSkillDirs(input: QualityInput, ref: string): Promise<string[] | null> {
  const res = await ghGet(
    `${GH_API}/repos/${input.owner}/${input.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    input,
  )
  if (!res || !res.ok) return null
  const body = (await res.json().catch(() => null)) as {
    tree?: Array<{ path?: string; type?: string }>
  } | null
  if (!body?.tree) return null
  const dirs = body.tree
    .filter((t) => t.type === 'blob' && typeof t.path === 'string')
    .map((t) => t.path as string)
    .filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .map((p) => (p === 'SKILL.md' ? '' : p.slice(0, -'/SKILL.md'.length)))
  return [...new Set(dirs)]
}

async function fetchSkillMd(input: QualityInput, ref: string, dir: string): Promise<string | null> {
  const path = dir ? `${dir}/SKILL.md` : 'SKILL.md'
  const res = await ghGet(
    `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${encodeURIComponent(ref)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    input,
  )
  if (!res || !res.ok) return null
  return await res.text().catch(() => null)
}

/** Body reads as a router/index (mostly links pointing at other skills). */
export function looksLikeRouterSkill(body: string): boolean {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 5) return false
  const linkLines = lines.filter((l) => /\[[^\]]+\]\([^)]+\)/.test(l)).length
  return linkLines / lines.length > 0.6
}

/** Score a single SKILL.md against the mechanical rubric (0-1 per component). */
export function lintSkillMarkdown(md: string): {
  validFrontmatter: boolean
  descriptionOk: boolean
  structured: boolean
  notRouter: boolean
} {
  const fm = parseFrontmatter(md)
  const validFrontmatter = Boolean(fm.name && fm.description)
  const desc = fm.description ?? ''
  const descriptionOk =
    desc.length > 0 && desc.length <= 500 && !MARKETING_WORDS.test(desc)
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
  const bodyLines = body.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const structured = /^##\s+/m.test(body) && bodyLines.length >= 10
  const notRouter = !looksLikeRouterSkill(body)
  return { validFrontmatter, descriptionOk, structured, notRouter }
}

/**
 * Assess a screened candidate. Never throws on network trouble — an
 * unreachable repo scores as indeterminate-low with a note, and the admin
 * queue (not this gate) stays the final arbiter.
 */
export async function assessCandidateQuality(input: QualityInput): Promise<QualityResult> {
  const notes: string[] = []
  const signals = await fetchRepoSignals(input)
  if (!signals) {
    return { score: 0, hardFail: 'could not fetch repo metadata for quality assessment', notes, skillCount: 0 }
  }
  const dirs = await fetchSkillDirs(input, signals.defaultBranch)
  if (!dirs) {
    return { score: 0, hardFail: 'could not read the repo tree for quality assessment', notes, skillCount: 0 }
  }
  if (dirs.length > MAX_PLAUSIBLE_SKILLS) {
    return {
      score: 0,
      hardFail: `${dirs.length} skill dirs exceeds the plausible cap for an authored library`,
      notes,
      skillCount: dirs.length,
    }
  }

  // Sample SKILL.md files evenly across the repo (first, middle, last…) so a
  // repo can't front-load its strongest skills ahead of weaker ones.
  const sample: string[] = []
  const step = Math.max(1, Math.floor(dirs.length / MAX_SKILL_SAMPLES))
  for (let i = 0; i < dirs.length && sample.length < MAX_SKILL_SAMPLES; i += step) {
    sample.push(dirs[i]!)
  }
  const lints = (
    await Promise.all(sample.map((dir) => fetchSkillMd(input, signals.defaultBranch, dir)))
  )
    .filter((md): md is string => typeof md === 'string')
    .map(lintSkillMarkdown)

  if (lints.length === 0) {
    return { score: 0, hardFail: 'no SKILL.md could be read for quality assessment', notes, skillCount: dirs.length }
  }
  const frac = (pick: (l: (typeof lints)[number]) => boolean) =>
    lints.filter(pick).length / lints.length

  const fmRatio = frac((l) => l.validFrontmatter)
  if (fmRatio === 0) {
    return {
      score: 0,
      hardFail: 'no sampled SKILL.md has valid frontmatter (name + description)',
      notes,
      skillCount: dirs.length,
    }
  }

  let score = 0
  const award = (points: number, max: number, label: string) => {
    const p = Math.round(points)
    score += p
    notes.push(`${label}: ${p}/${max}`)
  }
  award(fmRatio * 30, 30, `frontmatter valid in ${lints.filter((l) => l.validFrontmatter).length}/${lints.length} sampled`)
  award(frac((l) => l.descriptionOk) * 20, 20, 'descriptions state a capability (no marketing words)')
  award(frac((l) => l.structured) * 15, 15, 'bodies structured (sections + substance)')
  award(frac((l) => l.notRouter) * 10, 10, 'not router/index skills')

  // Provenance over stars: raw star counts are a weak signal in this category.
  let provenance = 0
  if (signals.ownerType === 'Organization') provenance += 10
  const ageDays = signals.createdAt
    ? (Date.now() - new Date(signals.createdAt).getTime()) / 86_400_000
    : 0
  if (ageDays > 30) provenance += 5
  const pushedDays = signals.pushedAt
    ? (Date.now() - new Date(signals.pushedAt).getTime()) / 86_400_000
    : Infinity
  if (pushedDays < 90) provenance += 5
  award(provenance, 20, `provenance (${signals.ownerType ?? 'unknown'}, ${Math.floor(ageDays)}d old, pushed ${Number.isFinite(pushedDays) ? Math.floor(pushedDays) + 'd ago' : 'unknown'})`)

  award(signals.stars >= 20 ? 5 : 0, 5, `stars ${signals.stars}`)

  return { score, hardFail: null, notes, skillCount: dirs.length }
}
