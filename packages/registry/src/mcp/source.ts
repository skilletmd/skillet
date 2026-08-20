// Registry-backed SkillSource for the hosted MCP endpoint.
//
// One source per request, scoped to ONE user: entries are synthesized from
// `buildSessionManifest` (the exact union sync serves), then filtered through
// the same serve guards the sync content path applies — `canReadSkill`,
// `serveBlockForModeration` (skill-level quarantine), and `serveBlockForScan`
// with a newest-servable-version fallback. Nothing outside the caller's
// manifest is ever visible, so the MCP layer's `httpAuthorized: true` fast
// path cannot leak another tenant's skills.
//
// File reads resolve through `skill_version_files` for the resolved version
// hash and fetch bytes from the blob store. A dangling blob reference throws
// (never returns null) so the MCP dispatcher surfaces a JSON-RPC error body
// instead of silently serving an empty skill.
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { SkillSource } from '@skillet/mcp';
import type { BlobStore } from '../blob-store/types.js';
import type { Principal } from '../auth/middleware.js';
export interface RegistrySourceContext {
    /** The MCP link owner's user id. */
    userId: string;
    /** The owner's claimed handle (null when unclaimed → empty manifest). */
    handle: string | null;
    /** The resolved mcp principal, threaded into canReadSkill. */
    principal: Principal;
}
/**
 * Build a per-request SkillSource over registry storage for one user.
 * Stateless: resolution happens lazily on first use and is cached for the
 * lifetime of the request.
 */
export function createRegistrySkillSource(_db: DatabaseSync, _blobStore: BlobStore, _ctx: RegistrySourceContext): SkillSource {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: createRegistrySkillSourcePrisma");
}
