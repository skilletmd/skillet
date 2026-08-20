import { canonicalContentHash } from '@skillet/protocol'
import { readState, readBundleFromSkillStore } from '../kit/store.js'
import { recordApproval, defaultApprovalLockPath } from '../trust/index.js'
import { accountClient, skillIdFromSlug } from '../registry/account-client.js'
import type { RegistryClient } from '../registry/client.js'

export interface ApproveOptions {
  /** Override the approval lock path (defaults to $XDG_DATA_HOME/skillet/skillet.lock). */
  approvalLockPath?: string
  /** Injectable account client for tests; defaults to the configured bearer. */
  client?: RegistryClient | null
}

/**
 * Non-interactively approves a specific version of a pending skill update,
 * recording it in the approval lock. A subsequent `skillet sync` will materialize
 * the approved version without prompting.
 *
 * Security invariants:
 *   - Only the exact version + content hash is approved; future versions or
 *     tampered content require separate explicit action.
 *   - The Ed25519 signature integrity check runs during the subsequent `skillet sync`
 *     (verifyForMaterialize), not here — matching the interactive approval flow
 *     where the user approves the diff before sync verifies the signature.
 *   - This does NOT bypass the quarantine gate (harm scan) — that still runs
 *     during sync for every materialization.
 *   - Approving one skill/version never widens trust for other skills, other
 *     versions, or the author's future updates.
 *
 * @param slug    Skill slug (e.g. "@taylor/festival-ops")
 * @param version Exact version number to approve (must match current pending state)
 */
export async function approveUpdate(
  slug: string,
  version: number,
  opts: ApproveOptions = {},
): Promise<void> {
  const { approvalLockPath = defaultApprovalLockPath() } = opts

  const state = await readState()
  const entry = state.skills[slug]
  if (!entry) {
    throw new Error(`Skill "${slug}" not found in kit.`)
  }
  if (entry.version !== version) {
    throw new Error(
      `Skill "${slug}" is at version ${entry.version}, not ${version}. ` +
        `Run \`skillet pending --json\` to see the current pending version.`,
    )
  }

  const bundle = await readBundleFromSkillStore(slug)
  const contentHash = canonicalContentHash(bundle)

  await recordApproval(approvalLockPath, slug, version, {
    contentHash,
    authorKeyId: entry.authorKeyId ?? '',
    approvedAt: new Date().toISOString(),
  })

  // Write through to the account-scoped record so the decision reaches every
  // device. Best-effort: the local lock above already succeeded, and sync
  // reconciles if this misses (offline / no bearer).
  const skillId = skillIdFromSlug(slug, entry.owner)
  if (skillId) {
    try {
      const client = opts.client ?? (await accountClient())
      await client?.postApproval(skillId, contentHash)
    } catch {
      // best-effort; local approval stands and reconciles on next sync.
    }
  }
}
