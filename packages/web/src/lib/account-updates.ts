// U9 — client-side wrappers for the account update-mode + decision endpoints.
// These run in the browser and go through the BFF proxy (`/api/registry/...`),
// which injects the session bearer from the httpOnly cookie. Mirrors the inline
// fetch pattern in kit-detail-client.tsx (saveTrust) and the agents-visibility
// toggle, centralized so the toggle and the Updates tab share one surface.
import { registryAuthApi, registrySkillApi } from './registry-proxy'
import type { DiffResponseFile } from '@skillet/protocol'
import type { SkillSecurity, SecurityFinding, ScanStatus } from './types'

export type UpdateMode = 'auto' | 'manual'

export interface UpdateItem {
  ref: string
  skill_id: string
  from_version: number | null
  /** Semver label for `from_version` ("major.minor.patch"); display only,
   *  null/absent on older registries. */
  from_version_label?: string | null
  to_version: number
  /** Semver label for `to_version`; display only, null/absent on older registries. */
  to_version_label?: string | null
  to_hash: string
  /** The target version's human changelog note, if the author wrote one. */
  release_note: string | null
  /** Browse category key, for the generated cover. */
  category: string | null
  /** The skill's one-line description (what it does). Shown as the subtitle for
   *  a brand-new skill, where there's no "what changed" to review. */
  description?: string | null
  author_name: string | null
  author_avatar_url: string | null
  /** Harm-scan verdict for the target version: 'clean' | 'flagged' |
   *  'quarantined' | 'pending' | null. Only flagged/quarantined surface a warning. */
  scan_status: string | null
  /** Number of flagged findings, for the "N signals" copy. */
  scan_findings: number
  /** The kit this update arrived through, for grouping the queue. null (or
   *  absent on older registries) when the skill came via a non-kit source (an
   *  author subscription) — those render as standalone rows. */
  source_kit?: UpdateSourceKit | null
}

/** The originating kit of a pending update, for grouping. `owner` is the kit's
 *  owner handle (a team slug or a person); `avatar_url` is the owner's avatar. */
export interface UpdateSourceKit {
  id: string
  name: string
  owner: string
  /** Kit slug for the permalink; null for kits without one. */
  slug: string | null
  avatar_url: string | null
}

export interface RecentlyAppliedItem {
  ref: string
  skill_id: string
  version_hash: string
  source: 'web' | 'desktop' | 'cli' | 'auto'
  decided_at: number
}

/** One device that carries a local edit of the skill (from the registry's
 *  `editedSkills[].devices`). The label names the machine; `last_seen_at` drives
 *  the "last synced X ago" recency. Content — filenames, line counts, bytes —
 *  never appears here; only the bare fact of the edit and its lineage. */
export interface EditedSkillDevice {
  device_id: string
  label: string | null
  last_seen_at: number | null
  edited_at: number
}

/** One "Skills you've edited" card: an edited skill whose author has shipped a
 *  newer upstream version, held out of bulk-approve (R5). Only the AUTHOR's side
 *  is described — the user's own edited version is never sent to the server, so
 *  it is never rendered here (R8, KD1). Upgrade routes through the normal
 *  decision rail on `to_hash`; the author diff is the baseline→target change. */
export interface EditedSkillItem {
  ref: string
  skill_id: string
  from_version_label: string | null
  to_version: number
  to_version_label: string | null
  to_hash: string
  /** The version the user forked from — the `from` of the author diff. */
  baseline_hash: string
  category: string | null
  author_name: string | null
  author_avatar_url: string | null
  /** True when the author shipped a newer version being held (Upgrade offered).
   *  False for an edit-only card: edited locally with no upstream update, so it
   *  renders without an Upgrade action or version arrow. Absent on older
   *  registries → treat as true (the pre-edit-only-row behavior). */
  has_upstream?: boolean
  /** Every device this skill is edited on, for the device-name row (R6). */
  devices: EditedSkillDevice[]
}

export interface MyUpdates {
  update_mode: UpdateMode
  pending: UpdateItem[]
  recently_applied: RecentlyAppliedItem[]
  /** The "Skills you've edited" section — additive; absent on older registries. */
  editedSkills?: EditedSkillItem[]
}

const jsonHeaders = { 'content-type': 'application/json', accept: 'application/json' }

// Bound every registry call so a hung upstream can't wedge the UI (e.g. a stuck
// modeBusy on the Updates page). A timeout aborts the fetch, which rejects the
// promise — callers' existing catch paths surface the error and clear busy state.
const REQUEST_TIMEOUT_MS = 15_000
const requestTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS)

/** Sets the account update mode. Returns how many pending updates were applied —
 *  non-zero only when flipping to 'auto', which approves the pending queue. */
export async function setUpdateMode(mode: UpdateMode): Promise<number> {
  const res = await fetch(registryAuthApi('me/update-mode'), {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ mode }),
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not update mode')
  return ((await res.json()) as { applied?: number }).applied ?? 0
}

export async function getMyUpdates(): Promise<MyUpdates> {
  const res = await fetch(registryAuthApi('me/updates'), {
    headers: { accept: 'application/json' },
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not load updates')
  return (await res.json()) as MyUpdates
}

/** Version-to-version "what's new" diff. `ref` is "author/slug"; hashes are
 *  canonical content hashes (the `to_hash` from getMyUpdates). */
export async function getSkillDiff(
  ref: string,
  toHash: string,
  fromHash?: string | null,
): Promise<{ from: string | null; to: string; files: DiffResponseFile[] }> {
  const params = new URLSearchParams({ to: toHash })
  if (fromHash) params.set('from', fromHash)
  const res = await fetch(registrySkillApi(`skills/${ref}/diff?${params.toString()}`), {
    headers: { accept: 'application/json' },
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not load diff')
  return (await res.json()) as { from: string | null; to: string; files: DiffResponseFile[] }
}

/** The scan findings for a specific version — the same `/scan` report the
 *  skill page uses, fetched on demand for the Updates "why flagged" modal. */
export async function getSkillScan(ref: string, hash: string): Promise<SkillSecurity> {
  const res = await fetch(registrySkillApi(`skills/${ref}/versions/${hash}/scan`), {
    headers: { accept: 'application/json' },
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not load scan')
  const report = (await res.json()) as {
    status: string
    scanned_at?: number | null
    findings_summary?: { total?: number }
    findings?: Array<{
      category: string
      confidence: SecurityFinding['confidence']
      file: string
      lineStart?: number
      lineEnd?: number
      line?: number
      why: string
      snippet?: string
      note?: string
    }>
  }
  const findings: SecurityFinding[] = (report.findings ?? []).map((f) => ({
    category: f.category,
    confidence: f.confidence,
    file: f.file,
    line: f.line ?? f.lineStart,
    why: f.why,
    snippet: f.snippet,
    note: f.note,
  }))
  return {
    status: (report.status as ScanStatus) ?? 'pending',
    scannedAt: report.scanned_at ? new Date(report.scanned_at * 1000).toISOString() : null,
    findingCount: report.findings_summary?.total ?? findings.length,
    findings,
  }
}

/** One pending kit removal (R5): the author dropped a skill you had. Remove
 *  lets devices prune it; Keep saves it to your Saved kit so it stays served. */
export interface RemovalItem {
  skill_id: string
  /** Null when the skill row was deleted upstream (Keep unavailable). */
  author_id: string | null
  slug: string | null
  keepable: boolean
  source_kit: UpdateSourceKit
}

export async function getMyRemovals(): Promise<RemovalItem[]> {
  const res = await fetch(registryAuthApi('me/removals'), {
    headers: { accept: 'application/json' },
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not load removals')
  return ((await res.json()) as { pending?: RemovalItem[] }).pending ?? []
}

export async function decideRemoval(
  skillId: string,
  kitId: string,
  action: 'remove' | 'keep',
): Promise<void> {
  const res = await fetch(registryAuthApi('removals'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ skill_id: skillId, kit_id: kitId, action }),
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not record the removal decision')
}

export async function approveUpdate(skillId: string, versionHash: string): Promise<void> {
  const res = await fetch(registryAuthApi('approvals'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ skill_id: skillId, version_hash: versionHash }),
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not approve update')
}

export async function rejectUpdate(skillId: string, versionHash: string): Promise<void> {
  const res = await fetch(registryAuthApi('rejections'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ skill_id: skillId, version_hash: versionHash }),
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not reject update')
}

/** One skill in a kit-group bulk action: the id and the version being decided. */
export interface DecidableItem {
  skill_id: string
  to_hash: string
}

/** The outcome of a fan-out: which skill ids the server accepted, and which
 *  failed. Partial failure is expected (one skill can 500 while others succeed),
 *  so the caller reconciles its local queue and nav badge against `ok` only —
 *  never against the input length. */
export interface FanOutResult {
  ok: string[]
  failed: string[]
}

async function fanOut(
  items: DecidableItem[],
  decide: (skillId: string, versionHash: string) => Promise<void>,
): Promise<FanOutResult> {
  const settled = await Promise.allSettled(
    items.map((it) => decide(it.skill_id, it.to_hash).then(() => it.skill_id)),
  )
  const ok: string[] = []
  const failed: string[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push(r.value)
    else failed.push(items[i].skill_id)
  })
  return { ok, failed }
}

/** Approve a set of pending updates (one kit group). Fans out over the per-skill
 *  approve endpoint so consent stays per-skill; grouping is presentation-only. */
export function approveItems(items: DecidableItem[]): Promise<FanOutResult> {
  return fanOut(items, approveUpdate)
}

/** Skip (reject) a set of pending updates (one kit group). Per-skill fan-out. */
export function rejectItems(items: DecidableItem[]): Promise<FanOutResult> {
  return fanOut(items, rejectUpdate)
}

// Bodyless writes: send only `accept`, never `content-type: application/json` —
// Fastify's JSON parser rejects an empty body under that content-type with a 400
// before the handler runs.
const acceptHeader = { accept: 'application/json' }

/** Mute a team kit (stop syncing it). */
export async function muteTeamKit(kitId: string): Promise<void> {
  const res = await fetch(registryAuthApi(`me/team-kits/${encodeURIComponent(kitId)}/mute`), {
    method: 'PUT',
    headers: acceptHeader,
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not mute team kit')
}

/** Unmute a team kit (resume syncing it). */
export async function unmuteTeamKit(kitId: string): Promise<void> {
  const res = await fetch(registryAuthApi(`me/team-kits/${encodeURIComponent(kitId)}/mute`), {
    method: 'DELETE',
    headers: acceptHeader,
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not unmute team kit')
}

/** Approve every currently-pending update. Returns how many were approved. */
export async function approveAll(): Promise<number> {
  const res = await fetch(registryAuthApi('approvals/all'), {
    method: 'POST',
    headers: jsonHeaders,
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not approve all')
  return ((await res.json()) as { approved: number }).approved
}

/** Skip (reject) every currently-pending update. Returns how many were skipped. */
export async function rejectAll(): Promise<number> {
  const res = await fetch(registryAuthApi('rejections/all'), {
    method: 'POST',
    headers: jsonHeaders,
    signal: requestTimeout(),
  })
  if (!res.ok) throw new Error('Could not skip all')
  return ((await res.json()) as { rejected: number }).rejected
}
