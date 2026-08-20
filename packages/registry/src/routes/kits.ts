import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaClient } from '@prisma/client'
import { ensureSessionPrincipal, requireUser, type Principal } from '../auth/middleware.js'
import { asHandle } from '../auth/identity.js'
import { newId } from '../db/index.js'
import { slugify } from '../slug.js'
import { canAdminOrgAuthorPrisma, canManageSkillPrisma } from '../lib/org-access.js'
import { resolveSkillRefPrisma } from '../lib/ref-resolution.js'
import { SUSPENDED_HANDLES_SUBQUERY } from '../lib/suspension.js'
import { bumpUserDeviceSyncPrisma } from '../lib/device-sync-stream.js'
import { baselineSkillDecisionPrisma } from './approvals.js'
import { canReadSkillPrisma } from '../auth/skill-read-access.js'
import {
  autoSnapshotSharedKitPrisma,
  isLinkedKitPrisma,
  isKitOwnerPrisma,
  pinKitSkillPrisma,
  publishKitVersionPrisma,
  removeKitSkillPrisma,
  revertKitToPublishedPrisma,
  upsertKitSkillPrisma,
} from '../lib/kit-mutations.js'
import {
  authorExistsPrisma,
  canReadKitPrisma,
  createKitPrisma,
  findKitBySourceRepoPrisma,
  getKitPayloadPrisma,
  getOrCreateSavedKitPrisma,
  kitNameTakenPrisma,
  kitOwnerRowPrisma,
  resolveKitByHandlePrisma,
} from '../lib/kit-payload.js'
import { invalidateCatalogCachesAfterPublish } from '../lib/cloudflare-catalog-purge.js'

interface KitSource {
  repo: string
  ref?: string | null
  path?: string | null
  sha?: string | null
  /**
   * Whether this kit live-syncs from the repo. A linked kit (default) is managed
   * by sync and locked from manual skill edits. A one-time import (`live: false`)
   * is an OWNED kit that merely records its origin repo — so its skills can be
   * linked at import time and the repo re-imported later to add more.
   */
  live?: boolean
}

interface CreateKitBody {
  owner: string
  name: string
  description?: string
  visibility?: 'private' | 'public'
  /** When present, the kit is a linked mirror of a GitHub repo. */
  source?: KitSource
}

interface PatchKitBody {
  name?: string
  description?: string | null
  visibility?: 'private' | 'public'
  profile_hidden?: boolean
  /** Record the commit synced after a re-pull from the linked source. */
  synced_sha?: string
  /** Convert a linked kit back to an owned kit (drops the repo link). */
  unlink?: boolean
}

interface KitParams {
  kitId: string
}

interface KitHandleParams {
  owner: string
  slug: string
}

interface KitSkillParams {
  kitId: string
  author: string
  slug: string
}

interface AddSkillBody {
  author: string
  slug: string
  pin_hash?: string | null
}

interface PinSkillBody {
  pin_hash: string | null
}

/**
 * The caller's auto-provisioned "Saved" kit — the one-click "+" target (their
 * Liked Songs of skills). One per owner, created lazily, private by default,
 * deployable like any kit. Returns its id.
 */
export function getOrCreateSavedKit(_db: DatabaseSync, _ownerHandle: string): string {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: getOrCreateSavedKitPrisma')
}

interface SessionPrincipal {
  user_id: string
  handle: string | null
}

function isV1Api(url: string | undefined): boolean {
  return (url ?? '').startsWith('/api/v1/')
}

const LINKED_SKILL_LOCK = {
  error: 'kit_is_linked',
  message: 'This kit mirrors a repo; its skills are managed there. Unlink to edit them in Skillet.',
} as const

async function requireKitOwnerAsync(
  req: FastifyRequest,
  reply: FastifyReply,
  kitId: string,
  prisma: PrismaClient,
): Promise<SessionPrincipal | null> {
  const p = await ensureSessionPrincipal(req, reply)
  if (!p) return null
  const allowed = await isKitOwnerPrisma(prisma, kitId, p)
  if (!allowed) {
    await reply.status(403).send({ error: 'not_owner', message: 'Only the kit owner can do this.' })
    return null
  }
  return p
}

/** Skill-id set from a snapshot JSON, for membership (major-bump) comparison. */
function snapshotSkillIds(snapshotJson: string): Set<string> {
  try {
    const snap = JSON.parse(snapshotJson) as { skills?: Array<{ skill_id?: string }> }
    return new Set((snap.skills ?? []).map((s) => s.skill_id).filter((x): x is string => !!x))
  } catch {
    return new Set()
  }
}

/**
 * Publish the current draft as the next immutable, numbered version (v1, v2, …)
 * — a GitHub-style release. Editing a kit only mutates the draft; nothing is
 * versioned until this is called, so assembling a new kit (create + add several
 * skills) publishes as a single v1. `note` is the optional release note shown in
 * the changelog. Returns the new version number, or null when the draft is
 * identical to the latest published version (nothing to publish).
 */
export function publishKitVersion(
  _db: DatabaseSync,
  _kitId: string,
  _note?: string | null,
  _publishedBy?: string | null,
): number {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: publishKitVersionPrisma')
}

/**
 * Assemble a kit's wire payload. By default this is the PUBLISHED view (what
 * subscribers and the public permalink see): skills come from the latest
 * published snapshot and pending draft edits are hidden. Pass `{ draft: true }`
 * for the owner's manage view, which shows the live draft plus its unpublished
 * diff so they can keep editing.
 */
export function getKitPayload(
  _db: DatabaseSync,
  _kitId: string,
  _opts?: { draft?: boolean },
): never {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: getKitPayloadPrisma')
}

// Exported so universal search reuses this exact kit visibility
// boundary instead of re-implementing private-kit access logic.
export function canReadKit(
  _db: DatabaseSync,
  _kit: { id: string; owner_id: string; visibility: string },
  _principal: unknown,
): boolean {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: canReadKitPrisma')
}


function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerKitRoutes(
  app: FastifyInstance,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ??
      (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  // POST /kits — create a kit
  app.post<{ Body: CreateKitBody }>('/kits', async (req, reply) => {
    let visibility: 'private' | 'public' = 'private'

    // SECURITY: creating a kit requires a session on BOTH mounts, and the owner
    // is always the authenticated handle. The legacy /v1 path previously took
    // `owner` from the body with no auth, letting anyone create kits under any
    // author's handle (impersonation / kit-squatting).
    const p = await ensureSessionPrincipal(req, reply)
    if (!p) return
    if (!p.handle) {
      return reply
        .status(403)
        .send({ error: 'handle_required', message: 'Claim a handle before managing kits.' })
    }
    let owner = p.handle
    {
      const body = req.body ?? {}
      // Create under your own handle, or under a team you administer — same
      // authorization skills use for org publishing (canAdminOrgAuthor).
      if (body.owner && body.owner !== owner) {
        const ok = await canAdminOrgAuthorPrisma(prisma, body.owner, p.user_id)
        if (!ok) {
          return reply.status(403).send({
            error: 'owner_mismatch',
            message: 'Create kits under your handle or a team you administer.',
          })
        }
        owner = asHandle(body.owner)
      }
      if (body.visibility === 'public' || body.visibility === 'private') {
        visibility = body.visibility
      }
    }

    const { name, description } = req.body ?? {}
    if (!name) {
      return reply.status(400).send({ error: 'name is required' })
    }

    
      if (!(await authorExistsPrisma(prisma, owner))) {
        return reply.status(404).send({ error: `Author '${owner}' not found` })
      }
      const source = (req.body ?? {}).source
      const sourceType = source?.repo ? (source.live === false ? 'owned' : 'linked') : 'owned'
      if (source?.repo) {
        const existing = await findKitBySourceRepoPrisma(prisma, owner, source.repo, sourceType)
        if (existing) {
          return reply
            .status(200)
            .send(await getKitPayloadPrisma(prisma, existing, { draft: true }))
        }
      }
      const slug = slugify(name)
      if (await kitNameTakenPrisma(prisma, owner, slug, name)) {
        return reply
          .status(409)
          .send({ error: 'kit_name_taken', message: `You already have a kit named "${name}".` })
      }
      const id = newId()
      await createKitPrisma(prisma, {
        id,
        ownerId: owner,
        name,
        slug,
        description: description ?? null,
        visibility,
        sourceType,
        sourceRepo: source?.repo ?? null,
        sourceRef: source?.ref ?? null,
        sourcePath: source?.path ?? null,
        lastSyncedSha: source?.sha ?? null,
      })
      await invalidateCatalogCachesAfterPublish()
      return reply.status(201).send(await getKitPayloadPrisma(prisma, id, { draft: true }))

  })

  // PATCH /kits/:kitId — update name, description, visibility (owner, session)
  app.patch<{ Params: KitParams; Body: PatchKitBody }>('/kits/:kitId', async (req, reply) => {
    if (!isV1Api(req.raw.url)) {
      return reply.status(404).send({ error: 'not_found' })
    }
    const { kitId } = req.params
    const ownerGate = await requireKitOwnerAsync(req, reply, kitId, prisma)
    if (!ownerGate) return

    const body = req.body ?? {}

    
      const kit = await prisma.kits.findUnique({
        where: { id: kitId },
        select: {
          owner_id: true,
          name: true,
          slug: true,
          description: true,
          visibility: true,
          profile_hidden: true,
        },
      })
      if (!kit) return reply.status(404).send({ error: 'Kit not found' })

      const name = body.name ?? kit.name
      let slug = kit.slug
      if (body.name !== undefined && body.name !== kit.name) {
        const newSlug = slugify(name)
        if (newSlug !== kit.slug) {
          const collision = await prisma.kits.findFirst({
            where: {
              owner_id: kit.owner_id,
              id: { not: kitId },
              OR: [{ slug: newSlug }, { name: { equals: name } }],
            },
            select: { id: true },
          })
          if (collision) {
            return reply
              .status(409)
              .send({ error: 'kit_name_taken', message: `You already have a kit named "${name}".` })
          }
          await prisma.kit_slug_aliases.deleteMany({
            where: { owner_id: kit.owner_id, slug: newSlug },
          })
          if (kit.slug) {
            await prisma.kit_slug_aliases.upsert({
              where: {
                owner_id_slug: { owner_id: kit.owner_id, slug: kit.slug },
              },
              create: {
                owner_id: kit.owner_id,
                slug: kit.slug,
                kit_id: kitId,
              },
              update: { kit_id: kitId },
            })
          }
          slug = newSlug
        }
      }

      const description = body.description !== undefined ? body.description : kit.description
      const visibility =
        body.visibility === 'public' || body.visibility === 'private'
          ? body.visibility
          : kit.visibility

      if (visibility === 'public' && kit.visibility !== 'public') {
        const privateSkills = await prisma.kit_skills.findMany({
          where: {
            kit_id: kitId,
            skills: { visibility: 'private' },
          },
          select: { skill_id: true },
        })
        if (privateSkills.length > 0) {
          return reply.status(422).send({
            error: 'kit_has_private_skills',
            message: `This kit can't go public while it contains private skills: ${privateSkills
              .map((s) => s.skill_id)
              .join(', ')}. Make them public or remove them first.`,
            skills: privateSkills.map((s) => s.skill_id),
          })
        }
      }

      const profileHidden =
        typeof body.profile_hidden === 'boolean'
          ? body.profile_hidden
            ? 1
            : 0
          : kit.profile_hidden

      const unlinkData = body.unlink
        ? {
            source_type: 'owned',
            source_repo: null,
            source_ref: null,
            source_path: null,
            last_synced_sha: null,
          }
        : typeof body.synced_sha === 'string'
          ? { last_synced_sha: body.synced_sha }
          : {}

      await prisma.kits.update({
        where: { id: kitId },
        data: {
          name,
          slug,
          description,
          visibility,
          profile_hidden: profileHidden,
          ...unlinkData,
        },
      })

      return reply.send(await getKitPayloadPrisma(prisma, kitId, { draft: true }))

  })

  // Shared body for the two kit-read routes (by id, by owner/slug). Sends the
  // kit payload with the viewer's subscription state, or a 404.
  async function sendKit(
    req: FastifyRequest,
    reply: FastifyReply,
    kitId: string,
    allowDraft = false,
  ) {
    
      const kitRow = await kitOwnerRowPrisma(prisma, kitId)
      if (!kitRow) {
        return reply.status(404).send({ error: 'Kit not found' })
      }
      if (!(await canReadKitPrisma(prisma, kitRow, req.principal))) {
        return reply.status(404).send({ error: 'Kit not found' })
      }
      const draft =
        allowDraft &&
        req.principal?.class === 'session' &&
        req.principal.handle === kitRow.owner_id
      const payload = await getKitPayloadPrisma(prisma, kitId, { draft })
      if (!payload) return reply.status(404).send({ error: 'Kit not found' })

      let subscribed = false
      let subscription_trust_mode: 'auto' | 'gate' | null = null
      if (req.principal?.class === 'session') {
        const row = await prisma.kit_subscriptions.findFirst({
          where: {
            user_id: req.principal.user_id,
            kind: 'kit',
            kit_id: kitId,
          },
          select: { trust_mode: true },
        })
        subscribed = !!row
        subscription_trust_mode = (row?.trust_mode as 'auto' | 'gate' | null) ?? null
      }

      const viewerUserId = req.principal?.class === 'session' ? req.principal.user_id : ''
      const subs = await prisma.kit_subscriptions.findMany({
        where: { kit_id: kitId, kind: 'kit' },
        select: {
          users: {
            select: {
              handle: true,
              suspended_at: true,
            },
          },
        },
      })
      const handles = subs
        .map((s) => s.users)
        .filter((u) => u.handle != null && u.suspended_at == null)
      const authorRows =
        handles.length > 0
          ? await prisma.authors.findMany({
              where: { id: { in: handles.map((u) => u.handle!).filter(Boolean) } },
              select: { id: true, name: true, avatar_url: true },
            })
          : []
      const authorByHandle = new Map(authorRows.map((a) => [a.id, a]))
      const followed = new Set<string>()
      if (viewerUserId) {
        const follows = await prisma.follows.findMany({
          where: {
            follower_user_id: viewerUserId,
            subject_kind: 'author',
            subject_id: { in: handles.map((u) => u.handle!).filter(Boolean) },
          },
          select: { subject_id: true },
        })
        for (const f of follows) followed.add(f.subject_id)
      }
      const subscribedByYou = handles
        .map((u) => {
          const author = authorByHandle.get(u.handle!)
          return {
            handle: u.handle!,
            name: author?.name ?? null,
            avatar_url: author?.avatar_url ?? null,
            followed: followed.has(u.handle!) ? 1 : 0,
          }
        })
        .sort((a, b) => b.followed - a.followed || a.handle.localeCompare(b.handle))
        .map(({ handle, name, avatar_url }) => ({ handle, name, avatar_url }))

      return reply.send({
        ...payload,
        subscribed,
        subscription_trust_mode,
        subscribed_by_you: subscribedByYou.slice(0, 5),
        subscribed_by_you_count: subscribedByYou.length,
      })

  }

  // GET /kits/by-handle/:owner/:slug — resolve a kit by its human permalink.
  // Registered before `/kits/:kitId` so "by-handle" isn't swallowed as an id.
  app.get<{ Params: KitHandleParams }>('/kits/by-handle/:owner/:slug', async (req, reply) => {
    const { owner, slug } = req.params
    const kitId = await resolveKitByHandlePrisma(prisma, owner, slug)
    if (!kitId) return reply.status(404).send({ error: 'Kit not found' })
    return sendKit(req, reply, kitId)
  })

  // GET /kits/:kitId — get a kit with its skills. The by-id route is the owner's
  // manage surface, so it may serve the draft view (gated to the owner inside
  // sendKit); the by-handle permalink above always serves the published view.
  app.get<{ Params: KitParams }>('/kits/:kitId', async (req, reply) => {
    return sendKit(req, reply, req.params.kitId, true)
  })

  // POST /kits/:kitId/skills — add a skill to a kit
  app.post<{ Params: KitParams; Body: AddSkillBody }>('/kits/:kitId/skills', async (req, reply) => {
    const { kitId } = req.params
    // SECURITY: auth runs on BOTH the /api/v1 and legacy /v1 mounts. Gating it on
    // isV1Api left /v1/kits/:id/skills as an unauthenticated mutation surface,
    // which reopened the B1 IDOR (add a stranger's private skill to your own kit).
    const principal = await requireKitOwnerAsync(req, reply, kitId, prisma)
    if (!principal) return

    const { author, slug, pin_hash } = req.body ?? {}

    if (!author || !slug) {
      return reply.status(400).send({ error: 'author and slug are required' })
    }

    
      if (await isLinkedKitPrisma(prisma, kitId)) return reply.status(422).send(LINKED_SKILL_LOCK)
      const kitExists = await prisma.kits.findUnique({
        where: { id: kitId },
        select: { id: true, visibility: true },
      })
      if (!kitExists) {
        return reply.status(404).send({ error: 'Kit not found' })
      }

      const resolved = await resolveSkillRefPrisma(prisma, author, slug)
      if (!resolved) {
        return reply.status(404).send({ error: `Skill '${author}/${slug}' not found` })
      }
      const skillId = resolved.skillId

      const skillRow = await prisma.skills.findUnique({
        where: { id: skillId },
        select: { visibility: true, latest_hash: true },
      })
      if (!skillRow) {
        return reply.status(404).send({ error: `Skill '${skillId}' not found` })
      }

      if (!(await canReadSkillPrisma(prisma, req.principal, skillId, skillRow.visibility))) {
        return reply.status(404).send({ error: `Skill '${skillId}' not found` })
      }

      // Re-share gate (#467): reading a private skill (e.g. via kit membership)
      // does NOT authorize re-exporting it. Only the skill's owner or an
      // org-admin of the owning org may curate a private skill into a kit,
      // otherwise a legit member could re-add it to their own kit and invite
      // third parties past the read ACL. Public skills stay open to curate.
      if (
        skillRow.visibility === 'private' &&
        !(await canManageSkillPrisma(prisma, skillId, principal.user_id))
      ) {
        return reply.status(403).send({
          error: 'only_owner_can_add_private_skill',
          message: `'${skillId}' is private. Only its owner can add it to a kit.`,
        })
      }

      if (kitExists.visibility === 'public' && skillRow.visibility === 'private') {
        return reply.status(422).send({
          error: 'private_skill_in_public_kit',
          message: `'${skillId}' is private and can't be added to a public kit. Make the skill public first, or keep the kit private.`,
        })
      }

      if (pin_hash) {
        const ver = await prisma.skill_versions.findFirst({
          where: { hash: pin_hash, skill_id: skillId },
          select: { hash: true },
        })
        if (!ver) {
          return reply
            .status(404)
            .send({ error: `Version '${pin_hash}' not found for skill '${skillId}'` })
        }
      }

      const { wasNew } = await upsertKitSkillPrisma(prisma, kitId, skillId, pin_hash ?? null)
      const target = pin_hash ?? skillRow.latest_hash
      if (target) await baselineSkillDecisionPrisma(prisma, principal.user_id, skillId, target)
      if (wasNew) {
        await bumpUserDeviceSyncPrisma(prisma, principal.user_id)
        // Shared (org/member) kits snapshot every membership change so removal
        // consent has history to derive from (R5). Personal kits skip this.
        await autoSnapshotSharedKitPrisma(prisma, kitId, principal.handle)
      }

      return reply.status(200).send(await getKitPayloadPrisma(prisma, kitId, { draft: true }))

  })

  // POST /me/library/skills — save a skill to the caller's auto "Saved" kit,
  // resolving (or creating) that kit server-side. This is the first-class
  // counterpart to the web Save button for `skillet add`: a saved skill becomes
  // a Saved-kit member (source_kit set), so it syncs across the user's devices,
  // flows through the /updates consent queue, and is edit-capturable — unlike a
  // bare install row. Requires a claimed handle (kits are handle-owned), same as
  // the web Save.
  // requireUser (not session-only): `skillet add` runs on a DEVICE token, so a
  // session-class gate would 403 the CLI. A device token tied to a user is
  // enough to manage that user's own Saved kit. The device Principal carries no
  // handle, so resolve it from user_id (the Saved kit is handle-owned).
  app.post<{ Body: AddSkillBody }>('/me/library/skills', { preHandler: requireUser() }, async (req, reply) => {
    const p = req.principal as Principal
    const userId = 'user_id' in p ? p.user_id : null
    if (!userId) {
      return reply.status(403).send({ error: 'account_required' })
    }
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { handle: true },
    })
    if (!user?.handle) {
      return reply
        .status(403)
        .send({ error: 'handle_required', message: 'Claim a handle to save skills to your library.' })
    }
    const handle = asHandle(user.handle)
    const { author, slug, pin_hash } = req.body ?? {}
    if (!author || !slug) {
      return reply.status(400).send({ error: 'author and slug are required' })
    }
    const resolved = await resolveSkillRefPrisma(prisma, author, slug)
    if (!resolved) {
      return reply.status(404).send({ error: `Skill '${author}/${slug}' not found` })
    }
    const skillId = resolved.skillId
    const skillRow = await prisma.skills.findUnique({
      where: { id: skillId },
      select: { visibility: true, latest_hash: true },
    })
    if (!skillRow) {
      return reply.status(404).send({ error: `Skill '${skillId}' not found` })
    }
    if (!(await canReadSkillPrisma(prisma, req.principal, skillId, skillRow.visibility))) {
      return reply.status(404).send({ error: `Skill '${skillId}' not found` })
    }
    // Re-share gate (#467): same rule as POST /kits/:kitId/skills. Reading a
    // private skill does not authorize curating it onward; only its owner or an
    // org-admin may. Fail-safe even though the Saved kit is personal today.
    if (
      skillRow.visibility === 'private' &&
      !(await canManageSkillPrisma(prisma, skillId, userId))
    ) {
      return reply.status(403).send({
        error: 'only_owner_can_add_private_skill',
        message: `'${skillId}' is private. Only its owner can add it to your library.`,
      })
    }
    const savedKitId = await getOrCreateSavedKitPrisma(prisma, handle)
    const { wasNew } = await upsertKitSkillPrisma(prisma, savedKitId, skillId, pin_hash ?? null)
    const target = pin_hash ?? skillRow.latest_hash
    // "add = consent": baseline the current version as approved so only FUTURE
    // versions queue for review (mirrors POST /kits/:id/skills).
    if (target) await baselineSkillDecisionPrisma(prisma, userId, skillId, target)
    if (wasNew) await bumpUserDeviceSyncPrisma(prisma, userId)
    return reply.status(200).send({
      ok: true,
      kit_id: savedKitId,
      kit_ref: `@${handle}/saved`,
      added: wasNew,
    })
  })

  // PATCH /kits/:kitId/skills/:author/:slug — pin/unpin a skill version
  app.patch<{ Params: KitSkillParams; Body: PinSkillBody }>(
    '/kits/:kitId/skills/:author/:slug',
    async (req, reply) => {
      const { kitId, author, slug } = req.params
      const ownerGate = await requireKitOwnerAsync(req, reply, kitId, prisma)
      if (!ownerGate) return
      const { pin_hash } = req.body ?? {}

      
        if (await isLinkedKitPrisma(prisma, kitId)) return reply.status(422).send(LINKED_SKILL_LOCK)
        const resolved = await resolveSkillRefPrisma(prisma, author, slug)
        if (!resolved) {
          return reply.status(404).send({ error: 'Skill not in kit' })
        }
        const skillId = resolved.skillId

        const inKit = await prisma.kit_skills.findUnique({
          where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
          select: { skill_id: true },
        })
        if (!inKit) {
          return reply.status(404).send({ error: 'Skill not in kit' })
        }

        if (pin_hash != null) {
          const ver = await prisma.skill_versions.findFirst({
            where: { hash: pin_hash, skill_id: skillId },
            select: { hash: true },
          })
          if (!ver) {
            return reply
              .status(404)
              .send({ error: `Version '${pin_hash}' not found for skill '${skillId}'` })
          }
        }

        await pinKitSkillPrisma(prisma, kitId, skillId, pin_hash ?? null)
        const live = await prisma.skills.findUnique({
          where: { id: skillId },
          select: { latest_hash: true },
        })
        const target = pin_hash ?? live?.latest_hash
        if (target) await baselineSkillDecisionPrisma(prisma, ownerGate.user_id, skillId, target)

        return reply.status(200).send(await getKitPayloadPrisma(prisma, kitId, { draft: true }))

    },
  )

  // DELETE /kits/:kitId/skills/:author/:slug — remove a skill from a kit
  app.delete<{ Params: KitSkillParams }>(
    '/kits/:kitId/skills/:author/:slug',
    async (req, reply) => {
      const { kitId, author, slug } = req.params
      const ownerGate = await requireKitOwnerAsync(req, reply, kitId, prisma)
      if (!ownerGate) return

      
        if (await isLinkedKitPrisma(prisma, kitId)) return reply.status(422).send(LINKED_SKILL_LOCK)
        const resolved = await resolveSkillRefPrisma(prisma, author, slug)
        if (!resolved) {
          return reply.status(404).send({ error: 'Skill not in kit' })
        }
        const skillId = resolved.skillId
        const removed = await removeKitSkillPrisma(prisma, kitId, skillId)
        if (!removed) {
          return reply.status(404).send({ error: 'Skill not in kit' })
        }
        // Shared (org/member) kits snapshot every membership change so removal
        // consent has history to derive from (R5); editor_id lets the remover
        // themselves prune silently while other members get the decision row.
        await autoSnapshotSharedKitPrisma(prisma, kitId, ownerGate.handle)
        await bumpUserDeviceSyncPrisma(prisma, ownerGate.user_id)
        return reply.status(200).send(await getKitPayloadPrisma(prisma, kitId, { draft: true }))

    },
  )

  // POST /kits/:kitId/publish — cut the next version from the current draft.
  app.post<{ Params: KitParams; Body: { note?: string } }>(
    '/kits/:kitId/publish',
    async (req, reply) => {
      if (!isV1Api(req.raw.url)) {
        return reply.status(404).send({ error: 'not_found' })
      }
      const { kitId } = req.params
      const ownerGate = await requireKitOwnerAsync(req, reply, kitId, prisma)
      if (!ownerGate) return

      const rawNote = (req.body ?? {}).note
      const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim() : null

      
        const version = await publishKitVersionPrisma(prisma, kitId, note, ownerGate.handle)
        await invalidateCatalogCachesAfterPublish()
        return reply.send({
          published: version !== null,
          ...(await getKitPayloadPrisma(prisma, kitId, { draft: true })),
        })

    },
  )

  // POST /kits/:kitId/revert — discard the draft, restoring the latest published
  // version. 400 when nothing has been published (no baseline to revert to).
  app.post<{ Params: KitParams }>('/kits/:kitId/revert', async (req, reply) => {
    if (!isV1Api(req.raw.url)) {
      return reply.status(404).send({ error: 'not_found' })
    }
    const { kitId } = req.params
    const ownerGate = await requireKitOwnerAsync(req, reply, kitId, prisma)
    if (!ownerGate) return

    
      const ok = await revertKitToPublishedPrisma(prisma, kitId)
      if (!ok) {
        return reply
          .status(400)
          .send({ error: 'no_published_version', message: 'Nothing published yet to revert to.' })
      }
      return reply.send(await getKitPayloadPrisma(prisma, kitId, { draft: true }))

  })

  // GET /kits/:kitId/versions — the kit's numbered changelog (newest first).
  app.get<{ Params: KitParams }>('/kits/:kitId/versions', async (req, reply) => {
    const { kitId } = req.params

    
      const kitRow = await kitOwnerRowPrisma(prisma, kitId)
      if (!kitRow || !(await canReadKitPrisma(prisma, kitRow, req.principal))) {
        return reply.status(404).send({ error: 'Kit not found' })
      }
      const rows = await prisma.kit_versions.findMany({
        where: { kit_id: kitId },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          major: true,
          minor: true,
          summary: true,
          editor_id: true,
          created_at: true,
          snapshot_json: true,
        },
      })
      const toRef = (id: string) => id.replace(':', '/')
      const versions = rows.map((r, i) => {
        const after = snapshotSkillIds(r.snapshot_json)
        const older = rows[i + 1]
        const before = older ? snapshotSkillIds(older.snapshot_json) : new Set<string>()
        const added = [...after].filter((id) => !before.has(id)).map(toRef)
        const removed = [...before].filter((id) => !after.has(id)).map(toRef)
        return {
          version: r.version,
          version_label: `${r.major}.${r.minor}`,
          major: r.major,
          minor: r.minor,
          summary: r.summary,
          editor: r.editor_id,
          created_at: r.created_at,
          skill_count: after.size,
          added,
          removed,
        }
      })
      return reply.send({ kit_id: kitId, versions })

  })

  // GET /kits/:kitId/related — "subscribers also added": other PUBLIC kits that
  // this kit's subscribers also added, ranked by how many of them overlap. A
  // public aggregate (no per-viewer data), so no auth — and the join filters to
  // public kits, so a private kit can never leak through.
  app.get<{ Params: KitParams }>('/kits/:kitId/related', async (req, reply) => {
    const { kitId } = req.params

    
      const kitRow = await kitOwnerRowPrisma(prisma, kitId)
      if (!kitRow || !(await canReadKitPrisma(prisma, kitRow, req.principal))) {
        return reply.status(404).send({ error: 'Kit not found' })
      }

      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; owner_id: string; name: string; slug: string; overlap: bigint | number }>
      >(
        `SELECT k.id, k.owner_id, k.name, k.slug,
                COUNT(DISTINCT ks2.user_id) AS overlap
           FROM kit_subscriptions ks1
           JOIN kit_subscriptions ks2
             ON ks2.user_id = ks1.user_id
            AND ks2.kind = 'kit'
            AND ks2.kit_id <> ks1.kit_id
           JOIN kits k ON k.id = ks2.kit_id AND k.visibility = 'public'
          WHERE ks1.kind = 'kit' AND ks1.kit_id = ?
            AND k.owner_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
          GROUP BY k.id, k.owner_id, k.name, k.slug, k.created_at
          ORDER BY overlap DESC, k.created_at DESC
          LIMIT 4`,
        kitId,
      )

      const kits = []
      for (const r of rows) {
        const skills = await prisma.kit_skills.findMany({
          where: { kit_id: r.id },
          orderBy: { added_at: 'asc' },
          select: {
            skill_id: true,
            skills: { select: { category: true } },
          },
        })
        const subscriberCount = await prisma.kit_subscriptions.count({
          where: { kit_id: r.id, kind: 'kit' },
        })
        kits.push({
          id: r.id,
          owner: r.owner_id,
          name: r.name,
          slug: r.slug,
          skill_count: skills.length,
          skill_refs: skills.map((s) => s.skill_id.replace(':', '/')),
          skill_categories: skills.map((s) => s.skills.category ?? null),
          subscriber_count: subscriberCount,
        })
      }

      return reply.send({ kit_id: kitId, kits })

  })
}
