// User-facing mapping for the 422 delegation failure codes the registry returns
// from `resolveAndVerifySigner` on a device-keyed propose/approve
// (§2.4 / §4.2 step 5).
//
// These codes mean the device key itself could not be authorized — distinct
// from a malformed-signature or authorization (kit/owner) failure, which the
// propose/approve flows already surface (see create-proposal.ts). The UX here is
// about getting the user to re-pair, re-enroll, or understand a revoke.

export type DelegationErrorCode =
  | 'delegation_not_found'
  | 'delegation_expired'
  | 'delegation_revoked'
  | 'delegation_scope_denied'

/** What the UI should offer the user in response to the failure. */
export type DelegationRecovery = 're-enroll' | 'contact-owner' | 'none'

export interface DelegationErrorUX {
  code: DelegationErrorCode
  title: string
  message: string
  recovery: DelegationRecovery
}

const UX: Record<DelegationErrorCode, Omit<DelegationErrorUX, 'code'>> = {
  delegation_not_found: {
    title: "This browser isn't enrolled",
    message:
      "No delegation is on file for this browser's signing key. Pair it again by running `skillet device approve` from the CLI, then retry.",
    recovery: 're-enroll',
  },
  delegation_expired: {
    title: 'This browser needs re-enrolling',
    message:
      "This browser's delegation has expired. Re-pair it with `skillet device approve` to keep proposing or approving from the web.",
    recovery: 're-enroll',
  },
  delegation_revoked: {
    title: 'This browser key was revoked',
    message:
      "This browser's signing key was revoked by the account owner and can no longer be used. If this is your browser, enroll a fresh key with `skillet device approve`.",
    recovery: 're-enroll',
  },
  delegation_scope_denied: {
    title: 'This browser may not perform that action',
    message:
      "This browser's delegation does not cover this action (for example, it can propose but not approve). Re-enroll with the needed scope or ask the account owner.",
    recovery: 'contact-owner',
  },
}

const DELEGATION_CODES = new Set<string>(Object.keys(UX))

/** True when `code` is one of the four device-delegation failure codes. */
export function isDelegationErrorCode(
  code: string | undefined | null,
): code is DelegationErrorCode {
  return code != null && DELEGATION_CODES.has(code)
}

/**
 * Resolve a registry error code to user-facing delegation copy. Unknown or
 * non-delegation codes fall back to a generic "not authorized" message so the
 * UI always has something to show (callers should branch on
 * `isDelegationErrorCode` first when they need code-specific handling).
 */
export function delegationErrorUX(code: string | undefined | null): DelegationErrorUX {
  if (isDelegationErrorCode(code)) {
    return { code, ...UX[code] }
  }
  return {
    code: 'delegation_not_found',
    title: "This browser can't sign right now",
    message:
      "This browser's signing key could not be authorized. Re-pair it with `skillet device approve` and try again.",
    recovery: 're-enroll',
  }
}
