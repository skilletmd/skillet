// Prisma helpers for GET /skills/:author/:slug detail payload (U4).
import type { PrismaDb } from '../db/prisma-client.js'
import { canManageSkillPrisma } from './org-access.js'
import { resolveInvocationFacts } from '../skill-frontmatter.js'
import { formatVersionLabel } from '../semver-classify.js'
import { toSkillSummary } from '../routes/skill-summary.js'
import { loadSkillSummaryByIdPrisma } from './skill-summary-prisma.js'
import { canReadSkillPrisma } from '../auth/skill-read-access.js'
import { platformAttestationKeyPrisma } from './platform-signing.js'

export type SkillDetailPrismaResult =
  | { kind: 'not_found' }
  | {
      kind: 'deprecated'
      body: {
        error: 'deprecated'
        deprecated: true
        deprecation_message: string | null
        deprecated_at: number
      }
    }
  | { kind: 'ok'; body: Record<string, unknown> }

async function suspendedHandles(prisma: PrismaDb): Promise<Set<string>> {
  const rows = await prisma.users.findMany({
    where: { suspended_at: { not: null }, handle: { not: null } },
    select: { handle: true },
  })
  return new Set(
    rows
      .map((r) => r.handle)
      .filter((h): h is string => typeof h === 'string' && h.length > 0),
  )
}

/** Build the skill detail JSON (or 404/410) for an authorized reader. */
export async function buildSkillDetailPrisma(
  prisma: PrismaDb,
  opts: {
    skillId: string
    canonAuthor: string
    canonSlug: string
    principal: Parameters<typeof canReadSkillPrisma>[1]
  },
): Promise<SkillDetailPrismaResult> {
  const { skillId, canonAuthor, canonSlug, principal } = opts
  const row = await loadSkillSummaryByIdPrisma(prisma, skillId)
  if (!row) return { kind: 'not_found' }

  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: {
      visibility: true,
      deprecated_at: true,
      deprecation_message: true,
      org_id: true,
      created_by_user_id: true,
    },
  })
  if (!skill) return { kind: 'not_found' }

  if (!(await canReadSkillPrisma(prisma, principal, skillId, skill.visibility))) {
    return { kind: 'not_found' }
  }

  const principalUserId = principal?.class === 'session' ? principal.user_id : null
  if (skill.deprecated_at != null) {
    const canManage =
      principalUserId != null && (await canManageSkillPrisma(prisma, skillId, principalUserId))
    if (!canManage) {
      return {
        kind: 'deprecated',
        body: {
          error: 'deprecated',
          deprecated: true,
          deprecation_message: skill.deprecation_message,
          deprecated_at: skill.deprecated_at,
        },
      }
    }
  }

  const [authorInfo, mirrorRow, authorKey, orgDetail, versionRows] = await Promise.all([
    prisma.authors.findUnique({
      where: { id: canonAuthor },
      select: {
        name: true,
        avatar_url: true,
        is_mirror: true,
        mirror_claimed_at: true,
      },
    }),
    prisma.skill_mirrors.findUnique({
      where: { skill_id: skillId },
      select: {
        source_repo: true,
        source_url: true,
        license: true,
        blocked_hash: true,
      },
    }),
    prisma.users.findFirst({
      where: { handle: canonAuthor },
      select: { author_key_id: true, author_public_key: true },
    }),
    skill.org_id
      ? prisma.skills.findUnique({
          where: { id: skillId },
          select: {
            organizations: { select: { slug: true } },
            users: { select: { handle: true } },
          },
        })
      : Promise.resolve(null),
    prisma.skill_versions.findMany({
      where: { skill_id: skillId, yanked_at: null },
      orderBy: [{ published_at: 'desc' }, { hash: 'desc' }],
      select: {
        hash: true,
        published_at: true,
        metadata_json: true,
        major: true,
        minor: true,
        patch: true,
      },
    }),
  ])

  const synced = !!mirrorRow
  const isMirror =
    synced && authorInfo?.is_mirror === 1 && authorInfo.mirror_claimed_at == null
  const githubSynced = synced && !isMirror
  let syncedLive = false
  if (synced && mirrorRow) {
    if (isMirror) {
      syncedLive = true
    } else {
      const [mOwner, mRepo] = mirrorRow.source_repo.split('/')
      if (mOwner && mRepo) {
        const live = await prisma.connected_repos.findFirst({
          where: {
            status: 'active',
            owner: mOwner,
            repo: mRepo,
            users: { handle: canonAuthor },
          },
          select: { id: true },
        })
        syncedLive = live != null
      }
    }
  }

  let triggers: string[] = []
  let evalStatus: 'passed' | 'failed' | 'none' = 'none'
  let metadataJson: string | null = null
  let latestSignerKeyId: string | null = null
  // Context-weight metering: the latest version's headline token count and its
  // standing (ambient) portion, for the skill hero's "~1.3K tokens". Null until
  // the row is backfilled.
  let tokenCount: number | null = null
  let tokenAmbient: number | null = null
  let tokenMethod: string | null = null
  if (row.latest_hash) {
    const metaRow = await prisma.skill_versions.findFirst({
      where: { hash: row.latest_hash },
      select: {
        metadata_json: true,
        author_key_id: true,
        token_count: true,
        token_ambient: true,
        token_method: true,
      },
    })
    if (metaRow) {
      metadataJson = metaRow.metadata_json
      latestSignerKeyId = metaRow.author_key_id
      tokenCount = metaRow.token_count
      tokenAmbient = metaRow.token_ambient
      tokenMethod = metaRow.token_method
      try {
        const meta = JSON.parse(metaRow.metadata_json) as {
          triggers?: unknown
          eval?: unknown
        }
        if (Array.isArray(meta.triggers)) {
          triggers = meta.triggers.filter((t): t is string => typeof t === 'string')
        }
        if (meta.eval === 'passed' || meta.eval === 'failed' || meta.eval === 'none') {
          evalStatus = meta.eval
        }
      } catch {
        /* ignore malformed metadata */
      }
    }
  }
  const { modelInvoked, hasCommand } = resolveInvocationFacts(metadataJson, !!row.description)

  // Served author identity keys to the signer of the latest version, matching
  // the manifest/version routes: platform identity when the latest version is
  // platform-attested, the claimed-user key otherwise.
  let servedKeyId = authorKey?.author_key_id ?? null
  let servedPublicKey = authorKey?.author_public_key ?? null
  if (latestSignerKeyId) {
    const platformKey = await platformAttestationKeyPrisma(prisma)
    if (latestSignerKeyId === platformKey.keyId) {
      servedKeyId = platformKey.keyId
      servedPublicKey = platformKey.publicKeyB64
    }
  }

  const suspended = await suspendedHandles(prisma)
  const [kitMembers, subscribers] = await Promise.all([
    prisma.kit_skills.findMany({
      where: {
        skill_id: skillId,
        kits: { OR: [{ visibility: 'public' }, { kind: 'saved' }] },
      },
      select: { kits: { select: { owner_id: true } } },
    }),
    prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        kits: {
          visibility: 'public',
          kit_skills: { some: { skill_id: skillId } },
        },
      },
      select: { users: { select: { handle: true } } },
    }),
  ])

  const handleSet = new Set<string>()
  for (const row of kitMembers) {
    const h = row.kits.owner_id
    if (h && h !== canonAuthor && !suspended.has(h)) handleSet.add(h)
  }
  for (const sub of subscribers) {
    const h = sub.users.handle
    if (h && h !== canonAuthor && !suspended.has(h)) handleSet.add(h)
  }

  const handles = [...handleSet]
  const [authors, followedRows] = await Promise.all([
    handles.length === 0
      ? Promise.resolve([])
      : prisma.authors.findMany({
          where: { id: { in: handles } },
          select: { id: true, name: true, avatar_url: true },
        }),
    principalUserId && handles.length > 0
      ? prisma.follows.findMany({
          where: {
            follower_user_id: principalUserId,
            subject_kind: 'author',
            subject_id: { in: handles },
          },
          select: { subject_id: true },
        })
      : Promise.resolve([]),
  ])
  const authorById = new Map(authors.map((a) => [a.id, a]))
  const followed = new Set(followedRows.map((f) => f.subject_id))
  const usedBy = handles
    .map((handle) => {
      const a = authorById.get(handle)
      return {
        handle,
        name: a?.name ?? null,
        avatar_url: a?.avatar_url ?? null,
        followed: followed.has(handle),
      }
    })
    .sort((a, b) => {
      if (a.followed !== b.followed) return a.followed ? -1 : 1
      return a.handle.localeCompare(b.handle)
    })
  const usedByYou = usedBy.filter((u) => u.followed).map((u) => u.handle)

  const versions = versionRows.map((v) => {
    let changelog: string | null = null
    let proposedBy: string | null = null
    try {
      const meta = JSON.parse(v.metadata_json) as {
        changelog?: unknown
        proposed_by?: unknown
      }
      if (typeof meta.changelog === 'string') changelog = meta.changelog
      if (typeof meta.proposed_by === 'string') proposedBy = meta.proposed_by
    } catch {
      /* ignore malformed metadata */
    }
    return {
      hash: v.hash,
      published_at: v.published_at,
      version_label: formatVersionLabel(v),
      ...(changelog ? { changelog } : {}),
      ...(proposedBy ? { proposed_by: proposedBy } : {}),
    }
  })

  const orgSlug = orgDetail?.organizations?.slug
  const createdBy = orgDetail?.users?.handle ?? null

  return {
    kind: 'ok',
    body: {
      ...toSkillSummary(row),
      versions,
      author_name: authorInfo?.name ?? null,
      author_avatar_url: authorInfo?.avatar_url ?? null,
      is_mirror: isMirror,
      github_synced: githubSynced,
      github_synced_live: syncedLive,
      mirror_source_url: synced ? (mirrorRow?.source_url ?? null) : null,
      mirror_license: synced ? (mirrorRow?.license ?? null) : null,
      mirror_upstream_blocked: synced ? mirrorRow?.blocked_hash != null : false,
      author_key_id: servedKeyId,
      author_public_key: servedPublicKey,
      manifest_url: `/api/v1/skills/${canonAuthor}/${canonSlug}/manifest`,
      triggers,
      eval: evalStatus,
      model_invoked: modelInvoked,
      has_command: hasCommand,
      deprecated: skill.deprecated_at != null,
      deprecation_message: skill.deprecation_message ?? null,
      used_by_you: usedByYou.slice(0, 5),
      used_by_you_count: usedByYou.length,
      used_by: usedBy.slice(0, 18),
      used_by_count: usedBy.length,
      ...(orgSlug ? { org_slug: orgSlug, created_by: createdBy } : {}),
      ...(tokenCount != null
        ? {
            token_count: tokenCount,
            ...(tokenAmbient != null ? { token_ambient: tokenAmbient } : {}),
            ...(tokenMethod ? { token_method: tokenMethod } : {}),
          }
        : {}),
    },
  }
}
