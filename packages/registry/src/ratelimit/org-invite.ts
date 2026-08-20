// Send gate for team-invite emails (POST /api/v1/orgs/:orgSlug/invites).
import type { PrismaDb } from '../db/prisma-client.js'

export interface OrgInviteSendLimitConfig {
  perInviterWindowSec: number
  perInviterMax: number
}

const DEFAULTS: OrgInviteSendLimitConfig = {
  perInviterWindowSec: 60 * 60,
  perInviterMax: 30,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadOrgInviteSendLimitConfig(): OrgInviteSendLimitConfig {
  return {
    perInviterWindowSec: readPositiveInt(
      'SKILLET_ORG_INVITE_WINDOW_SEC',
      DEFAULTS.perInviterWindowSec,
    ),
    perInviterMax: readPositiveInt('SKILLET_ORG_INVITE_MAX', DEFAULTS.perInviterMax),
  }
}

export interface OrgInviteSendDecision {
  allowed: boolean
}

/** Whether `invitedBy` may send another invite email now. */
export async function orgInviteEmailDecisionPrisma(
  prisma: PrismaDb,
  args: { invitedBy: string; now: number },
  config: OrgInviteSendLimitConfig = loadOrgInviteSendLimitConfig(),
): Promise<OrgInviteSendDecision> {
  const since = args.now - config.perInviterWindowSec
  const count = await prisma.organization_invites.count({
    where: { invited_by: args.invitedBy, created_at: { gte: since } },
  })
  return { allowed: count <= config.perInviterMax }
}

/**
 * Fail-closed stand-in for residual dual-path org callers outside U2.
 */
export function orgInviteEmailDecision(
  _db: unknown,
  _args: { invitedBy: string; now: number },
  _config?: OrgInviteSendLimitConfig,
): OrgInviteSendDecision {
  throw new Error('sqlite registry store removed; use orgInviteEmailDecisionPrisma')
}
