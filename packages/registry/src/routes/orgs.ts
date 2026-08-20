// Org (team) management routes.
//
// All session-gated:
//   POST   /api/v1/orgs                                  — create org (caller becomes owner)
//   POST   /api/v1/orgs/:orgSlug/invites                 — invite by handle or email
//   GET    /api/v1/orgs/:orgSlug/members                 — list accepted + pending members
//   DELETE /api/v1/orgs/:orgSlug/members/:memberId       — remove a member OR revoke a pending invite (owner/admin)
//   PATCH  /api/v1/orgs/:orgSlug/members/:memberId       — change a member's role (owner-only)
//   POST   /api/v1/orgs/:orgSlug/invites/:inviteId/accept — redeem a pending invite for the caller
//   GET    /api/v1/orgs                                      — list caller's orgs
//   GET    /api/v1/orgs/invites                              — pending invites addressed to the caller
//   GET    /api/v1/orgs/:orgSlug/skills                      — org-owned skills
//
// v1 role model: owner > admin > member. Only owner/admin may invite or remove;
// only the owner may change roles. The owner can never be removed or demoted.
// The slug is the stable public identifier (lower-kebab, ≤39 chars).
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { requireSession } from '../auth/middleware.js'
import { newId } from '../db/index.js'
import {
  getOrgBySlugPrisma,
  handleOrSlugTakenPrisma,
  isOrgAdminPrisma,
  isOrgMemberPrisma,
} from '../lib/org-access.js'
import {
  findOrganizationMemberPrisma,
  findOrgInvitePrisma,
  hasDuplicatePendingInvitePrisma,
  listPendingInvitesForUserPrisma,
  verifiedEmailForHandlePrisma,
} from '../lib/org-invites.js'
import {
  acceptOrgInvitePrisma,
  createOrgInvitePrisma,
  createOrganizationPrisma,
  findUserIdByHandlePrisma,
  listCallerOrgsPrisma,
  listOrgMembersPrisma,
  listOrgPendingInvitesPrisma,
  listOrgSkillSummariesPrisma,
  removeOrgMemberPrisma,
  revokeOrgInvitePrisma,
  updateOrgMemberRolePrisma,
} from '../lib/org-mutations.js'
import { userHasVerifiedEmailMatchPrisma } from '../auth/identities.js'
import {
  toSkillSummary,
} from './skill-summary.js'
import { mailDeliveryConfigured, sendOrgInviteEmail } from '../auth/magic-link-mail.js'
import { bumpAttentionForHandlePrisma } from '../lib/attention.js'
import {
  orgInviteEmailDecisionPrisma,
} from '../ratelimit/org-invite.js'

/** Web base for accept links; falls back to prod like the rest of the registry. */
function webBaseUrl(): string {
  return (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '')
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/
const VALID_ROLES = new Set(['owner', 'admin', 'member'])

interface OrgParams {
  orgSlug: string
}

interface MemberParams {
  orgSlug: string
  memberId: string
}

interface InviteAcceptParams {
  orgSlug: string
  inviteId: string
}

interface RoleBody {
  role?: string
}

interface SessionPrincipal {
  user_id: string
  handle: string | null
}

interface CreateOrgBody {
  slug?: string
  name?: string
}

interface InviteBody {
  handle?: string
  email?: string
  role?: string
}

function prismaForOrgRoutes(
  app: FastifyInstance,
  explicit?: PrismaClient,
): PrismaClient | undefined {
  if (explicit) return explicit
  if (app.skilletPrismaAuth && app.skilletPrisma) return app.skilletPrisma
  return undefined
}


function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerOrgRoutes(
  app: FastifyInstance,
  prismaArg?: PrismaClient,
  devAuth = false,
): void {
  const prisma = requirePrisma(prismaForOrgRoutes(app, prismaArg))

  // POST /api/v1/orgs — create a new organization; caller becomes owner.
  app.post<{ Body: CreateOrgBody }>(
    '/api/v1/orgs',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : ''
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''

      if (!SLUG_RE.test(slug)) {
        return reply.code(400).send({
          error: 'invalid_slug',
          message:
            'Org slug must be 1-40 lowercase alphanumeric characters or hyphens.',
        })
      }
      if (!name) {
        return reply.code(400).send({ error: 'name_required' })
      }

      
        if (await handleOrSlugTakenPrisma(prisma, slug)) {
          return reply.code(409).send({ error: 'slug_taken' })
        }
        const orgId = newId()
        await createOrganizationPrisma(prisma, {
          orgId,
          slug,
          name,
          ownerUserId: principal.user_id,
        })
        return reply.code(201).send({ org_id: orgId, slug, name })

    },
  )

  // POST /api/v1/orgs/:orgSlug/invites — invite a user by handle or email.
  app.post<{ Params: OrgParams; Body: InviteBody }>(
    '/api/v1/orgs/:orgSlug/invites',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const { orgSlug } = req.params
      const body = req.body ?? {}

      
        const org = await getOrgBySlugPrisma(prisma, orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        if (
          !(await isOrgAdminPrisma(prisma, org.id, principal.user_id, org.owner_user_id))
        ) {
          return reply.code(403).send({ error: 'not_authorized' })
        }

        const hasHandle = typeof body.handle === 'string' && body.handle.length > 0
        const hasEmail = typeof body.email === 'string' && body.email.length > 0
        if (hasHandle === hasEmail) {
          return reply.code(400).send({ error: 'provide_handle_or_email' })
        }

        const role =
          typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : 'member'
        if (role === 'owner') {
          return reply.code(400).send({ error: 'cannot_invite_as_owner' })
        }

        if (hasHandle) {
          const userId = await findUserIdByHandlePrisma(prisma, body.handle!)
          if (userId) {
            const already = await findOrganizationMemberPrisma(prisma, org.id, userId)
            if (already) return reply.code(409).send({ error: 'already_member' })
          }
        }

        if (
          await hasDuplicatePendingInvitePrisma(
            prisma,
            org.id,
            hasHandle ? body.handle! : null,
            hasEmail ? body.email! : null,
          )
        ) {
          return reply.code(409).send({ error: 'already_invited' })
        }

        const inviteId = newId()
        await createOrgInvitePrisma(prisma, {
          inviteId,
          orgId: org.id,
          handle: hasHandle ? body.handle! : null,
          email: hasEmail ? body.email! : null,
          role,
          invitedBy: principal.user_id,
        })

        const acceptUrl = `${webBaseUrl()}/settings/teams/accept?org=${encodeURIComponent(
          org.slug,
        )}&invite=${encodeURIComponent(inviteId)}`

        const recipient = hasEmail
          ? body.email!
          : await verifiedEmailForHandlePrisma(prisma, body.handle!)

        if (mailDeliveryConfigured() && recipient) {
          const now = Math.floor(Date.now() / 1000)
          const gate = await orgInviteEmailDecisionPrisma(prisma, {
            invitedBy: principal.user_id,
            now,
          })
          if (gate.allowed) {
            try {
              const mailed = await sendOrgInviteEmail({
                to: recipient,
                orgName: org.name,
                inviterName: principal.handle,
                role,
                acceptUrl,
              })
              if (!mailed.ok) {
                req.log.error({ err: mailed.error, orgSlug: org.slug }, 'org invite email failed')
              }
            } catch (err) {
              req.log.error({ err, orgSlug: org.slug }, 'org invite email threw')
            }
          } else {
            req.log.warn({ orgSlug: org.slug }, 'org invite email rate-limited')
          }
        }

        if (hasHandle) {
          await bumpAttentionForHandlePrisma(prisma, body.handle!)
        }

        return reply.send({
          status: 'invited',
          invite_id: inviteId,
          ...(devAuth ? { dev_accept_url: acceptUrl } : {}),
        })

    },
  )

  // GET /api/v1/orgs/:orgSlug/members — list accepted + pending members.
  // Requires org membership.
  app.get<{ Params: OrgParams }>(
    '/api/v1/orgs/:orgSlug/members',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const { orgSlug } = req.params

      
        const org = await getOrgBySlugPrisma(prisma, orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        if (
          !(await isOrgMemberPrisma(prisma, org.id, principal.user_id, org.owner_user_id))
        ) {
          return reply.code(403).send({ error: 'not_authorized' })
        }

        const members = await listOrgMembersPrisma(prisma, org.id)
        const pending = await listOrgPendingInvitesPrisma(prisma, org.id)

        return reply.send({
          org: { id: org.id, slug: org.slug, name: org.name },
          members: members.map((m) => ({
            user_id: m.user_id,
            handle: m.handle,
            role: m.role,
            invited_at: m.invited_at,
            accepted_at: m.accepted_at,
          })),
          pending: pending.map((p) => ({
            invite_id: p.id,
            handle: p.handle,
            email: p.email,
            role: p.role,
            invited_at: p.created_at,
          })),
        })

    },
  )

  // DELETE /api/v1/orgs/:orgSlug/members/:memberId — remove an accepted member
  // or revoke a pending invite. Owner/admin only; the owner can never be
  // removed. `:memberId` is a user_id for accepted members and an invite_id for
  // pending invites — the member-list response surfaces both as the row's id,
  // so the web layer passes whichever the row carries and the handler resolves
  // it: accepted member first, then pending invite.
  app.delete<{ Params: MemberParams }>(
    '/api/v1/orgs/:orgSlug/members/:memberId',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const { orgSlug, memberId } = req.params

      
        const org = await getOrgBySlugPrisma(prisma, orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        if (
          !(await isOrgAdminPrisma(prisma, org.id, principal.user_id, org.owner_user_id))
        ) {
          return reply.code(403).send({ error: 'not_authorized' })
        }

        if (memberId === org.owner_user_id) {
          return reply.code(400).send({ error: 'cannot_remove_owner' })
        }

        if (await removeOrgMemberPrisma(prisma, org.id, memberId)) {
          return reply.send({ status: 'removed', member_id: memberId })
        }
        if (await revokeOrgInvitePrisma(prisma, org.id, memberId)) {
          return reply.send({ status: 'revoked', invite_id: memberId })
        }
        return reply.code(404).send({ error: 'member_not_found' })

    },
  )

  // PATCH /api/v1/orgs/:orgSlug/members/:memberId — change an accepted member's
  // role. Owner-only. Role must be 'admin' or 'member'; 'owner' is not
  // assignable (ownership transfer is out of scope) and the owner's own role is
  // immutable.
  app.patch<{ Params: MemberParams; Body: RoleBody }>(
    '/api/v1/orgs/:orgSlug/members/:memberId',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const { orgSlug, memberId } = req.params
      const body = req.body ?? {}

      
        const org = await getOrgBySlugPrisma(prisma, orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        if (principal.user_id !== org.owner_user_id) {
          return reply.code(403).send({ error: 'not_authorized' })
        }

        const role = body.role
        if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
          return reply.code(400).send({ error: 'invalid_role' })
        }
        if (role === 'owner') {
          return reply.code(400).send({ error: 'cannot_assign_owner' })
        }
        if (memberId === org.owner_user_id) {
          return reply.code(400).send({ error: 'cannot_change_owner_role' })
        }

        if (!(await updateOrgMemberRolePrisma(prisma, org.id, memberId, role))) {
          return reply.code(404).send({ error: 'member_not_found' })
        }
        return reply.send({ status: 'updated', member_id: memberId, role })

    },
  )

  // POST /api/v1/orgs/:orgSlug/invites/:inviteId/accept — redeem a pending
  // (email / unknown-handle) invite for the authenticated session. The caller
  // must match the invite's target: a handle invite matches the session handle;
  // an email invite matches an email on one of the caller's linked identities.
  // On success the caller is added as an accepted member and the invite is
  // marked redeemed.
  app.post<{ Params: InviteAcceptParams }>(
    '/api/v1/orgs/:orgSlug/invites/:inviteId/accept',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      const { orgSlug, inviteId } = req.params

      
        const org = await getOrgBySlugPrisma(prisma, orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        const invite = await findOrgInvitePrisma(prisma, inviteId, org.id)
        if (!invite) return reply.code(404).send({ error: 'invite_not_found' })
        if (invite.redeemed_at != null) {
          return reply.code(409).send({ error: 'invite_already_redeemed' })
        }

        let matches = false
        if (invite.handle != null) {
          matches = principal.handle != null && principal.handle === invite.handle
        } else if (invite.email != null) {
          // Only an IdP-VERIFIED identity for the invited address may accept.
          // Matching an unverified email would let anyone who parked that
          // address on an identity join the org and read its private skills.
          matches = await userHasVerifiedEmailMatchPrisma(prisma, principal.user_id, invite.email)
        }
        if (!matches) {
          return reply.code(403).send({ error: 'invite_not_for_caller' })
        }

        await acceptOrgInvitePrisma(prisma, {
          orgId: org.id,
          userId: principal.user_id,
          invite,
        })

        return reply.send({
          status: 'accepted',
          org: { id: org.id, slug: org.slug, name: org.name },
          role: invite.role,
        })

    },
  )

  // GET /api/v1/orgs — list all orgs the caller is an accepted member of.
  app.get('/api/v1/orgs', { preHandler: requireSession }, async (req, reply) => {
    const principal = req.principal as SessionPrincipal

    
      const rows = await listCallerOrgsPrisma(prisma, principal.user_id)
      return reply.send({
        orgs: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, role: r.role })),
      })

  })

  // GET /api/v1/orgs/invites — pending invites addressed to the caller. This is
  // the invitee's reverse view: the members/accept routes are org-scoped and
  // gated to the sender, so an invitee could only ever act on an invite via the
  // emailed deep link. Matching mirrors the accept handler — a handle invite
  // matches the session handle, an email invite matches an email on one of the
  // caller's linked identities. Orgs the caller has already joined are excluded
  // (a leftover unredeemed invite there is not actionable). Registered before
  // the `:orgSlug` routes so the literal segment wins.
  app.get('/api/v1/orgs/invites', { preHandler: requireSession }, async (req, reply) => {
    const principal = req.principal as SessionPrincipal

    
      const rows = await listPendingInvitesForUserPrisma(
        prisma,
        principal.user_id,
        principal.handle,
      )
      return reply.send({
        invites: rows.map((r) => ({
          invite_id: r.invite_id,
          org_slug: r.org_slug,
          org_name: r.org_name,
          role: r.role,
          invited_at: r.invited_at,
          invited_by_handle: r.invited_by_handle,
        })),
      })

  })

  // GET /api/v1/orgs/:orgSlug/skills — skills published under @org/slug.
  app.get<{ Params: OrgParams }>(
    '/api/v1/orgs/:orgSlug/skills',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal
      
        const org = await getOrgBySlugPrisma(prisma, req.params.orgSlug)
        if (!org) return reply.code(404).send({ error: 'org_not_found' })

        if (
          !(await isOrgMemberPrisma(prisma, org.id, principal.user_id, org.owner_user_id))
        ) {
          return reply.code(403).send({ error: 'not_authorized' })
        }

        const rows = await listOrgSkillSummariesPrisma(prisma, org.slug)
        return reply.send({
          org_slug: org.slug,
          skills: rows.map(toSkillSummary),
        })

    },
  )
}
