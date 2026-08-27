import type { Principal } from './middleware.js';

/**
 * Whether a principal represents a real account, i.e. carries a `user_id`.
 *
 * "Presented a valid token" is NOT the same question. `session` and `mcp`
 * principals always carry a user; a `device` principal carries one only once
 * paired; a `kit` principal carries none at all. Treating any valid bearer as
 * account-bound would file kit-key and unpaired-device traffic as engaged
 * reach, which is a different claim than the one summon standing makes.
 *
 * Null (anonymous) is a first-class case, not a failure: the summon flow is
 * built to work with nothing installed and no account.
 */
export function isAccountBound(principal: Principal | null | undefined): boolean {
  if (!principal) return false;
  switch (principal.class) {
    case 'session':
    case 'mcp':
      return true;
    case 'device':
      return principal.user_id != null;
    case 'kit':
      return false;
  }
}
