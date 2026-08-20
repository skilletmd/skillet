// PROTOCOL §3 token classes.
//
// All bearer tokens carry a short ASCII class prefix so the verifier can
// route to the correct table without a second lookup, and so leaked secrets
// in logs are visually attributable to a class.
//
//   skillet_d_<32-byte-hex>  device token
//   skillet_s_<32-byte-hex>  user session (GitHub-OAuth-backed in prod)
//   skillet_k_<32-byte-hex>  kit key (scoped to one kit)
//   skillet_m_<32-byte-hex>  personal MCP link (read-only; embedded in a URL)
//
// The raw secret is shown to the caller exactly once at mint. The registry
// stores only sha256(secret) — a DB exfil cannot replay an existing token.
// (The MCP link is the one deliberate exception: its secret is additionally
// kept AES-256-GCM-encrypted so settings can re-show the link — see routes/mcp.ts.)
import { createHash, randomBytes } from 'node:crypto';

export type TokenClass = 'device' | 'session' | 'kit' | 'mcp';

const PREFIX: Record<TokenClass, string> = {
  device: 'skillet_d_',
  session: 'skillet_s_',
  kit: 'skillet_k_',
  mcp: 'skillet_m_',
};

const SCOPES: Record<TokenClass, readonly string[]> = {
  device: ['read', 'sync'],
  session: ['read', 'sync', 'publish', 'claim'],
  kit: ['read', 'sync'],
  // Read-only by construction (R7): an MCP link can never publish, sync-write,
  // or claim — a leaked link URL exposes reads, not the account.
  mcp: ['read'],
};

export function scopesFor(cls: TokenClass): readonly string[] {
  return SCOPES[cls];
}

/**
 * Sliding idle-expiry window for device tokens (#464). Each authenticated
 * request extends `devices.expires_at` to `now + this`, so an actively-syncing
 * device (including the unattended desktop sidecar) never expires, while a
 * dormant leaked copy dies after ~90 days of non-use.
 */
export const DEVICE_TOKEN_TTL_SEC = 7_776_000; // 90 days

export function mintToken(cls: TokenClass): { secret: string; hash: string } {
  const secret = PREFIX[cls] + randomBytes(32).toString('hex');
  return { secret, hash: hashToken(secret) };
}

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function classifyToken(secret: string): TokenClass | null {
  if (secret.startsWith(PREFIX.device)) return 'device';
  if (secret.startsWith(PREFIX.session)) return 'session';
  if (secret.startsWith(PREFIX.kit)) return 'kit';
  if (secret.startsWith(PREFIX.mcp)) return 'mcp';
  return null;
}

export function parseBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader);
  return m ? m[1] : null;
}
