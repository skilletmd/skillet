import { canonicalContentHash } from '@skillet/protocol'
import { readState, readBundleFromSkillStore } from '../kit/store.js'
import { recordRejection, defaultApprovalLockPath } from '../trust/index.js'
import { accountClient, skillIdFromSlug } from '../registry/account-client.js'
import type { RegistryClient } from '../registry/client.js'

export interface RejectOptions {
  /** Override the approval lock path (defaults to $XDG_DATA_HOME/skillet/skillet.lock). */
  approvalLockPath?: string
  /** Injectable account client for tests; defaults to the configured bearer. */
  client?: RegistryClient | null
}

/**
 * Non-interactively rejects the current pending version of a skill update,
 * recording it in the approval lock. A subsequent `skillet sync` will skip this
 * version without prompting.
 *
 * Security invariants:
 *   - Version-scoped: rejecting v3 does not suppress the review prompt for v4.
 *   - Rejecting one skill does not affect other skills or the author's trust level.
 *   - The rejected version will not be materialized until a new version arrives
 *     and the user takes an explicit action on it.
 *
 * @param slug Skill slug (e.g. "@taylor/festival-ops")
 */
export async function rejectUpdate(slug: string, opts: RejectOptions = {}): Promise<void> {
  const { approvalLockPath = defaultApprovalLockPath() } = opts

  const state = await readState()
  const entry = state.skills[slug]
  if (!entry) {
    throw new Error(`Skill "${slug}" not found in kit.`)
  }

  await recordRejection(approvalLockPath, slug, entry.version, {
    authorKeyId: entry.authorKeyId ?? '',
    rejectedAt: new Date().toISOString(),
  })

  // Write through to the account-scoped record (best-effort; reconciles on sync).
  const skillId = skillIdFromSlug(slug, entry.owner)
  if (skillId) {
    try {
      const bundle = await readBundleFromSkillStore(slug)
      const client = opts.client ?? (await accountClient())
      await client?.postRejection(skillId, canonicalContentHash(bundle))
    } catch {
      // best-effort; local rejection stands.
    }
  }
}
