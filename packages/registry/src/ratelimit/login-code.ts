// Send limiter for POST /api/v1/auth/login-code/send.
import type { PrismaDb } from '../db/prisma-client.js'

export interface LoginCodeSendLimitConfig {
  perEmailWindowSec: number
  perEmailMax: number
  perIpWindowSec: number
  perIpMax: number
  globalWindowSec: number
  globalMax: number
}

const DEFAULTS: LoginCodeSendLimitConfig = {
  perEmailWindowSec: 60,
  perEmailMax: 3,
  perIpWindowSec: 60 * 60,
  perIpMax: 20,
  globalWindowSec: 60,
  globalMax: 300,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadLoginCodeSendLimitConfig(): LoginCodeSendLimitConfig {
  return {
    perEmailWindowSec: readPositiveInt('SKILLET_LOGIN_CODE_EMAIL_WINDOW_SEC', DEFAULTS.perEmailWindowSec),
    perEmailMax: readPositiveInt('SKILLET_LOGIN_CODE_EMAIL_MAX', DEFAULTS.perEmailMax),
    perIpWindowSec: readPositiveInt('SKILLET_LOGIN_CODE_IP_WINDOW_SEC', DEFAULTS.perIpWindowSec),
    perIpMax: readPositiveInt('SKILLET_LOGIN_CODE_IP_MAX', DEFAULTS.perIpMax),
    globalWindowSec: readPositiveInt('SKILLET_LOGIN_CODE_GLOBAL_WINDOW_SEC', DEFAULTS.globalWindowSec),
    globalMax: readPositiveInt('SKILLET_LOGIN_CODE_GLOBAL_MAX', DEFAULTS.globalMax),
  }
}

export type LoginCodeSendDecision =
  | { allowed: true }
  | { allowed: false; scope: 'email' | 'ip' | 'global' }

/** Prisma twin for the MySQL send path. */
export async function loginCodeSendDecisionPrisma(
  prisma: PrismaDb,
  input: { email: string; ip: string; now: number },
  cfg: LoginCodeSendLimitConfig = loadLoginCodeSendLimitConfig(),
): Promise<LoginCodeSendDecision> {
  const { email, ip, now } = input
  const [globalCount, emailCount, ipCount] = await Promise.all([
    prisma.email_login_codes.count({
      where: { created_at: { gte: now - cfg.globalWindowSec } },
    }),
    prisma.email_login_codes.count({
      where: { email, created_at: { gte: now - cfg.perEmailWindowSec } },
    }),
    prisma.email_login_codes.count({
      where: { request_ip: ip, created_at: { gte: now - cfg.perIpWindowSec } },
    }),
  ])
  if (globalCount >= cfg.globalMax) return { allowed: false, scope: 'global' }
  if (emailCount >= cfg.perEmailMax) return { allowed: false, scope: 'email' }
  if (ipCount >= cfg.perIpMax) return { allowed: false, scope: 'ip' }
  return { allowed: true }
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U2.
 */
export function loginCodeSendDecision(
  _db: unknown,
  _input: { email: string; ip: string; now: number },
  _cfg?: LoginCodeSendLimitConfig,
): LoginCodeSendDecision {
  throw new Error('sqlite registry store removed; use loginCodeSendDecisionPrisma')
}
