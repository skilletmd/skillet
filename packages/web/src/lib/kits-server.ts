import { cookies } from 'next/headers'
import { readSessionCookie } from './session-cookie'
import { getScanReportsBatch, type BatchScanEntry } from './registry'
import { unionCapabilities } from './capability-union'
import type { BlindSpot, SecurityFinding, SkillCapabilityReport } from './types'
import type { KitSkillEntry } from './kits'
import {
  addSkillToKitRequest,
  createKitRequest,
  getAuthorKitRequest,
  getKitByHandleRequest,
  getKitRequest,
  getKitVersionsRequest,
  getRelatedKitsRequest,
  listMineKitsRequest,
  patchKitRequest,
  removeSkillFromKitRequest,
  subscribeAuthorRequest,
  subscribeKitRequest,
  unsubscribeAuthorRequest,
  unsubscribeKitRequest,
  type AuthorKitResult,
  type CreateKitResult,
  type KitResult,
  type KitVersionsResult,
  type RelatedKitsResult,
  type KitVisibility,
  type ListMineResult,
  type MutateKitResult,
  type SubscribeResult,
} from './kits'

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

async function serverToken(): Promise<string | null> {
  const jar = await cookies()
  return readSessionCookie(jar) ?? null
}

export async function listMyKits(): Promise<ListMineResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return listMineKitsRequest(registryBaseUrl(), token)
}

export async function getKit(kitId: string): Promise<KitResult> {
  const token = await serverToken()
  return getKitRequest(registryBaseUrl(), token, kitId)
}

export async function getKitByHandle(owner: string, slug: string): Promise<KitResult> {
  const token = await serverToken()
  return getKitByHandleRequest(registryBaseUrl(), token, owner, slug)
}

/**
 * Bubble up a kit's installer-facing capability manifest: the deduped
 * union of its member skills' capability reports. Each member is read from the
 * same public per-version `/scan` endpoint a skill page uses, then merged by
 * {@link unionCapabilities} — a capability appears if ANY member has it, risky
 * rolls up, evidence is deduped (so a mirrored/duplicate member never double-
 * counts). There is no kit-specific detection.
 *
 * This is ONE cacheable batch GET (registry U5) keyed by the kit's member
 * `(author, slug, hash)` set — not N per-member fetches — while keeping the same
 * shared/CDN caching the per-member reads had (`revalidate`). A member the
 * registry omits (unreadable) is treated as the identity-only "no scan" case,
 * still counting toward `partial`.
 *
 * Returns `null` when NO member had a computed report (renders nothing),
 * `{ capabilities: [], analysis }` when computed-but-inert, a non-empty report
 * otherwise. The rolled-up `analysis` is `'partial'` if any member was not
 * computed or was itself partial — so an un-analyzed member never reads as inert.
 */
export async function getKitCapabilities(
  skills: KitSkillEntry[],
): Promise<SkillCapabilityReport | null> {
  const emptyScan: BatchScanEntry = { capabilities: null, findings: [], blindSpots: [] }

  // skill_id is "author:slug"; the version is the pinned hash when the kit pins
  // one, otherwise the member's current published hash.
  const members = skills.map((entry) => {
    const sep = entry.skill_id.indexOf(':')
    const author = sep < 0 ? '' : entry.skill_id.slice(0, sep)
    const slug = sep < 0 ? '' : entry.skill_id.slice(sep + 1)
    const hash = entry.pinned_hash ?? entry.current_hash
    return { author, slug, hash }
  })

  // Only fully-resolvable members go to the batch; the rest carry identity only.
  const resolvable = members.filter(
    (m): m is { author: string; slug: string; hash: string } =>
      !!m.author && !!m.slug && !!m.hash,
  )
  const batch = resolvable.length ? await getScanReportsBatch(resolvable) : new Map<string, BatchScanEntry>()

  // Carry identity even when the scan is absent, so the union still counts this
  // member toward `partial` and never mis-attributes a capability.
  const perSkill = members.map((m) => {
    if (!m.author || !m.slug || !m.hash) {
      return { author: m.author, slug: m.slug, hash: null, scan: emptyScan }
    }
    const scan = batch.get(`${m.author}/${m.slug}/${m.hash}`) ?? emptyScan
    return { author: m.author, slug: m.slug, hash: m.hash, scan }
  })

  const report = unionCapabilities(
    perSkill.map((m) => ({ author: m.author, slug: m.slug, report: m.scan.capabilities })),
  )
  if (!report) return null

  // Roll up member threat findings, each tagged with its source skill so the kit
  // panel can name which skill is flagged (deduped by category+file+line+skill).
  const findings: SecurityFinding[] = []
  const seen = new Set<string>()
  for (const m of perSkill) {
    if (!m.author || !m.slug) continue
    for (const f of m.scan.findings) {
      // Hold the scanner's own bar: low findings are informational and never
      // change a skill's status (see rollupStatus), so a member the skill page
      // calls clean must not appear under the kit's FLAGGED band.
      if (f.confidence === 'low') continue
      const id = `${f.category} ${f.file} ${f.line} ${m.author}/${m.slug}`
      if (seen.has(id)) continue
      seen.add(id)
      findings.push({ ...f, skill: { author: m.author, slug: m.slug } })
    }
  }

  // Roll up member unscanned files the same way, tagged with the source skill so
  // the kit "Unscanned files" chip can group + deep-link them (deduped by
  // file+skill).
  const blindSpots: BlindSpot[] = []
  const seenBlind = new Set<string>()
  for (const m of perSkill) {
    if (!m.author || !m.slug) continue
    for (const file of m.scan.blindSpots) {
      const id = `${file} ${m.author}/${m.slug}`
      if (seenBlind.has(id)) continue
      seenBlind.add(id)
      blindSpots.push({ file, skill: { author: m.author, slug: m.slug } })
    }
  }

  // Members with no computed report at all — what actually drives `partial` when
  // there are no blind-spot files. Named so the panel can list them instead of
  // implying unreadable files. Deduped by identity.
  //
  // Two distinct causes, kept apart because the honest sentence differs:
  //   - NO HASH → the skill has no installable version (every version was held
  //     by the scanner or yanked, so `latest_hash` is null). It WAS scanned; the
  //     scan is precisely why there's nothing to install. Calling that "not yet
  //     scanned" states the opposite of what happened.
  //   - HASH, NO REPORT → genuinely not analyzed yet.
  const unscannedSkills: { author: string; slug: string }[] = []
  const unavailableSkills: { author: string; slug: string }[] = []
  const seenUnscanned = new Set<string>()
  for (const m of perSkill) {
    if (!m.author || !m.slug) continue
    if (m.hash && m.scan.capabilities !== null) continue
    const id = `${m.author}/${m.slug}`
    if (seenUnscanned.has(id)) continue
    seenUnscanned.add(id)
    if (m.hash) unscannedSkills.push({ author: m.author, slug: m.slug })
    else unavailableSkills.push({ author: m.author, slug: m.slug })
  }

  return { ...report, findings, blindSpots, unscannedSkills, unavailableSkills }
}

export async function getKitVersions(kitId: string): Promise<KitVersionsResult> {
  const token = await serverToken()
  return getKitVersionsRequest(registryBaseUrl(), token, kitId)
}

export async function getRelatedKits(kitId: string): Promise<RelatedKitsResult> {
  const token = await serverToken()
  return getRelatedKitsRequest(registryBaseUrl(), token, kitId)
}

export async function createKit(body: {
  name: string
  description?: string
  visibility?: KitVisibility
}): Promise<CreateKitResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return createKitRequest(registryBaseUrl(), token, body)
}

export async function patchKit(
  kitId: string,
  body: { name?: string; description?: string | null; visibility?: KitVisibility },
): Promise<MutateKitResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return patchKitRequest(registryBaseUrl(), token, kitId, body)
}

export async function addSkillToKit(
  kitId: string,
  author: string,
  slug: string,
): Promise<MutateKitResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return addSkillToKitRequest(registryBaseUrl(), token, kitId, author, slug)
}

export async function removeSkillFromKit(
  kitId: string,
  author: string,
  slug: string,
): Promise<MutateKitResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return removeSkillFromKitRequest(registryBaseUrl(), token, kitId, author, slug)
}

export async function getAuthorKit(author: string): Promise<AuthorKitResult> {
  const token = await serverToken()
  return getAuthorKitRequest(registryBaseUrl(), token, author)
}

export async function subscribeKit(kitId: string): Promise<SubscribeResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return subscribeKitRequest(registryBaseUrl(), token, kitId)
}

export async function unsubscribeKit(kitId: string): Promise<SubscribeResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return unsubscribeKitRequest(registryBaseUrl(), token, kitId)
}

export async function subscribeAuthor(author: string): Promise<SubscribeResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return subscribeAuthorRequest(registryBaseUrl(), token, author)
}

export async function unsubscribeAuthor(author: string): Promise<SubscribeResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return unsubscribeAuthorRequest(registryBaseUrl(), token, author)
}
