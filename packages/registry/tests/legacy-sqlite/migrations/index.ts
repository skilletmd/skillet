import type { RegistryMigration } from '../migrate-runner.js'
import { migration001RegistryBaseline } from './001-registry-baseline.js'
import { migration002PairClaimAttempts } from './002-pair-claim-attempts.js'
import { migration003MirrorSkills } from './003-mirror-skills.js'
import { migration004ConnectedRepos } from './004-connected-repos.js'
import { migration005KitVersionMajorMinor } from './005-kit-version-major-minor.js'
import { migration006ConnectedRepoSelection } from './006-connected-repo-selection.js'
import { migration007KitKind } from './007-kit-kind.js'
import { migration008SkillCategory } from './008-skill-category.js'
import { migration009SkillInstallers } from './009-skill-installers.js'
import { migration010KitSlug } from './010-kit-slug.js'
import { migration011DeviceAgents } from './011-device-agents.js'
import { migration012AgentsPublic } from './012-agents-public.js'
import { migration013UserIsAdmin } from './013-user-is-admin.js'
import { migration014Events } from './014-events.js'
import { migration015DeviceKitSync } from './015-device-kit-sync.js'
import { migration016SkillRuntimeReach } from './016-skill-runtime-reach.js'
import { migration017MagicLinkConfirmColumns } from './017-magic-link-confirm-columns.js'
import { migration018NotificationsSeen } from './018-notifications-seen.js'
import { migration019NotificationIndexes } from './019-notification-indexes.js'
import { migration020UpdateDecisions } from './020-update-decisions.js'
import { migration021VersionScanNotices } from './021-version-scan-notices.js'
import { migration022MirrorBlockedHash } from './022-mirror-blocked-hash.js'
import { migration023DeviceSkillMaterializations } from './023-device-skill-materializations.js'
import { migration024DeviceClientKind } from './024-device-client-kind.js'
import { migration025IdentityProviderLogin } from './025-identity-provider-login.js'
import { migration026IdentityEmailIndex } from './026-identity-email-index.js'
import { migration027UserGithubTokens } from './027-user-github-tokens.js'
import { migration028AuthorXHandle } from './028-author-x-handle.js'
import { migration029ConnectedRepoAsKit } from './029-connected-repo-as-kit.js'
import { migration030ConnectedRepoPublishAs } from './030-connected-repo-publish-as.js'
import { migration031HandleSlugUniqueness } from './031-handle-slug-uniqueness.js'
import { migration032SkillVersionCapabilities } from './032-skill-version-capabilities.js'
import { migration033SkillVersionCapabilitiesVersion } from './033-skill-version-capabilities-version.js'
import { migration034SkillVersionCompositeKey } from './034-skill-version-composite-key.js'
import { migration035SkillVersionSigVersion } from './035-skill-version-sig-version.js'
import { migration036DeviceClientPlatform } from './036-device-client-platform.js'
import { migration037BrandMirrorsToOrgs } from './037-brand-mirrors-to-orgs.js'
import { migration038MirrorReviewQueue } from './038-mirror-review-queue.js'
import { migration039MirrorSourceOwnerType } from './039-mirror-source-owner-type.js'
import { migration040AuthorShownAgents } from './040-author-shown-agents.js'
import { migration041UpdateDecisionsDecidedIndex } from './041-update-decisions-decided-index.js'
import { migration042SkillSourceProvenance } from './042-skill-source-provenance.js'
import { migration043SkillReportsAndModeration } from './043-skill-reports-and-moderation.js'
import { migration044KitModerationAndFeatured } from './044-kit-moderation-and-featured.js'
import { migration045SessionDeviceLink } from './045-session-device-link.js'
import { migration046PlatformAttestationKey } from './046-platform-attestation-key.js'
import { migration047SkillVersionSemver } from './047-skill-version-semver.js'
import { migration048UserAttentionSeq } from './048-user-attention-seq.js'
import { migration049DevicesUserIdNotNull } from './049-devices-user-id-not-null.js'
import { migration050McpLinks } from './050-mcp-links.js'
import { migration051McpCallAttemptsLink } from './051-mcp-call-attempts-link.js'
import { migration052McpCallAttemptsTimeIndex } from './052-mcp-call-attempts-time-index.js'
import { migration053BackfillKitSkillBaselines } from './053-backfill-kit-skill-baselines.js'
import { migration054EmailLoginCodes } from './054-email-login-codes.js'
import { migration055DropMagicLink } from './055-drop-magic-link.js'
import { migration056IdentityProfileHints } from './056-identity-profile-hints.js'
import { migration057DeviceSkillEdits } from './057-device-skill-edits.js'
import { migration058SkillAvailabilityRename } from './058-skill-availability-rename.js'
import { migration059BackfillLinkedKitSlugs } from './059-backfill-linked-kit-slugs.js'
import { migration060DevicesMachineId } from './060-devices-machine-id.js'
import { migration061McpLinkClients } from './061-mcp-link-clients.js'
import { migration062UserDeviceSyncSeq } from './062-user-device-sync-seq.js'
import { migration063DevicesClientKinds } from './063-devices-client-kinds.js'
import { migration064SearchSourceCounts } from './064-search-source-counts.js'

/** Ordered registry migrations — append only; never renumber. */
export const REGISTRY_MIGRATIONS: RegistryMigration[] = [
  migration001RegistryBaseline,
  migration002PairClaimAttempts,
  migration003MirrorSkills,
  migration004ConnectedRepos,
  migration005KitVersionMajorMinor,
  migration006ConnectedRepoSelection,
  migration007KitKind,
  migration008SkillCategory,
  migration009SkillInstallers,
  migration010KitSlug,
  migration011DeviceAgents,
  migration012AgentsPublic,
  migration013UserIsAdmin,
  migration014Events,
  migration015DeviceKitSync,
  migration016SkillRuntimeReach,
  migration017MagicLinkConfirmColumns,
  migration018NotificationsSeen,
  migration019NotificationIndexes,
  migration020UpdateDecisions,
  migration021VersionScanNotices,
  migration022MirrorBlockedHash,
  migration023DeviceSkillMaterializations,
  migration024DeviceClientKind,
  migration025IdentityProviderLogin,
  migration026IdentityEmailIndex,
  migration027UserGithubTokens,
  migration028AuthorXHandle,
  migration029ConnectedRepoAsKit,
  migration030ConnectedRepoPublishAs,
  migration031HandleSlugUniqueness,
  migration032SkillVersionCapabilities,
  migration033SkillVersionCapabilitiesVersion,
  migration034SkillVersionCompositeKey,
  migration035SkillVersionSigVersion,
  migration036DeviceClientPlatform,
  migration037BrandMirrorsToOrgs,
  migration038MirrorReviewQueue,
  migration039MirrorSourceOwnerType,
  migration040AuthorShownAgents,
  migration041UpdateDecisionsDecidedIndex,
  migration042SkillSourceProvenance,
  migration043SkillReportsAndModeration,
  migration044KitModerationAndFeatured,
  migration045SessionDeviceLink,
  migration046PlatformAttestationKey,
  migration047SkillVersionSemver,
  migration048UserAttentionSeq,
  migration049DevicesUserIdNotNull,
  migration050McpLinks,
  migration051McpCallAttemptsLink,
  migration052McpCallAttemptsTimeIndex,
  migration053BackfillKitSkillBaselines,
  migration054EmailLoginCodes,
  migration055DropMagicLink,
  migration056IdentityProfileHints,
  migration057DeviceSkillEdits,
  migration058SkillAvailabilityRename,
  migration059BackfillLinkedKitSlugs,
  migration060DevicesMachineId,
  migration061McpLinkClients,
  migration062UserDeviceSyncSeq,
  migration063DevicesClientKinds,
  migration064SearchSourceCounts,
]

export const REGISTRY_SCHEMA_HEAD = REGISTRY_MIGRATIONS.at(-1)?.version ?? 0
