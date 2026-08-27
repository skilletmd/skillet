export * from "./adapter.js";
export { REGISTRY_API } from "./registry-api.js";
export * from "./bundle/index.js";
export * from "./kit/index.js";
export {
  saveIdentity,
  loadIdentity,
  identityPath,
  type Identity,
} from "./identity/index.js";
export { login, type LoginOptions, type LoginResult } from "./commands/login.js";
export {
  publish,
  publishAll,
  PublishError,
  type PublishOptions,
  type PublishResult,
  type PublishErrorCode,
} from "./commands/publish.js";
export {
  propose,
  proposeCustomized,
  ProposeError,
  type ProposeOptions,
  type ProposeResult,
  type ProposeErrorCode,
  type ProposeTarget,
  type ProposeBase,
  type ProposeCustomizedResult,
  type ProposeCustomizedAccepted,
  type ProposeCustomizedRefused,
} from "./commands/propose.js";
export {
  evalSkills,
  type EvalSkillResult,
} from "./commands/eval.js";
export * from "./lock.js";
export { stableMachineId, deriveMachineId } from "./machine-identity.js";
export * from "./metrics.js";
export * from "./commands/import.js";
export * from "./github/index.js";
export {
  discoverGitHubSkills,
  importGitHubSkill,
  type DiscoveredGitHubSkill,
  type GitHubDiscovery,
  type DiscoverOptions,
  type ImportGitHubOptions,
} from "./commands/import-github.js";
export {
  discoverExistingSkills,
  importDiscoveredSkills,
  runtimeLabel,
  runtimePhrase,
  runtimesAcross,
  type DiscoveredSkill,
  type DiscoveryReport,
  type ImportDiscoveredResult,
} from "./commands/discover.js";
export * from "./commands/sync.js";
// Curated customized-skills surface: only what the CLI/desktop actually
// consume. Internals (moveDir, ledgerStamp, backupSkillVersion, drift
// detection, …) stay module-level exports for core's own commands and tests,
// but are not part of the package API.
export {
  listCustomized,
  listLiveEdits,
  takeUpstream,
  restoreOriginal,
  keepMine,
  lineageRef,
  readLiveCustomizedTree,
  ReconcileError,
  type CustomizedSkill,
  type LiveEdit,
  type ReconcileResult,
  type ReconcileOptions,
  type ReconcileErrorCode,
} from "./commands/edits.js";
// Moved to the leaf ./commands/edits-store.js (breaks the edits↔sync cycle);
// re-pointed here so the public export names stay identical.
export {
  listBackups,
  type SkillLineage,
  type BackupEntry,
  type BackupManifest,
  type BackupReason,
} from "./commands/edits-store.js";
export {
  BUNDLED_ROUTE_SLUG,
  BUNDLED_CREATE_SLUG,
  BUNDLED_META_SLUGS,
  KNOWN_ROUTE_SURFACES,
  listRouteManifest,
  recordRouteInvocation,
  recordSkillRoute,
  resolveRouteBody,
  ROUTE_RESPONSE_MAX_BYTES,
  RouteSkillError,
  skillRefFromEntry,
  type RouteBody,
  type RouteManifestEntry,
  type RouteInvocationOptions,
  type RouteSurface,
  type RecordSkillRouteOptions,
  type RouteSkillErrorCode,
} from "./commands/route.js";
export {
  summonHandle,
  searchPublicSkills,
  fetchSummonBody,
  type SummonCandidate,
  type SummonResult,
} from "./commands/summon.js";
export {
  installRouteHook,
  installRouteHooksForRuntimes,
  hookRuntimesFromDetected,
  canInjectContext,
  CONTEXT_INJECTING_RUNTIMES,
  isHookCapableRuntime,
  installCursorRouteHook,
  type RouteHookInstallOptions,
  type RouteHookInstallResult,
  type InstallRouteHooksResult,
  type CursorRouteHookInstallOptions,
  type CursorRouteHookInstallResult,
} from "./commands/route-hooks/index.js";
export {
  ensureBundledRouteSkill,
  ensureBundledCreateSkill,
  ensureBundledSkill,
  type EnsureBundledRouteResult,
} from "./commands/bundled-route-skill.js";
export {
  materializeSkills,
  type MaterializeSkillsOptions,
  type MaterializeSkillsResult,
} from "./commands/materialize-skills.js";
export {
  skillIdToRef,
  kitSkillRefsFromIds,
} from "./commands/kit-add-materialize.js";
export {
  listTrash,
  restoreTrash,
  clearOldTrash,
  sweepOrphans,
  type TrashRun,
  type RestoreResult,
  type SweepResult,
} from "./commands/restore.js";
export * from "./commands/status.js";
export { add, type AddOptions, type AddResult } from "./commands/add.js";
export {
  extractPairCode,
  isValidPairCode,
  normalizePairCode,
  PAIR_CODE_LEN,
  PAIR_CODE_RE,
} from "./pair-code.js";
export {
  listPending,
  type PendingEntry,
  type PendingResult,
  type PendingOptions,
} from "./commands/pending.js";
export {
  approveUpdate,
  type ApproveOptions,
} from "./commands/approve.js";
export {
  rejectUpdate,
  type RejectOptions,
} from "./commands/reject.js";
export {
  claimHandle,
  secondaryDeviceMessage,
  type ClaimOptions,
  type ClaimResult,
} from "./commands/claim.js";
export {
  authLogout,
  type AuthLogoutOptions,
} from "./commands/auth-logout.js";
export {
  authDisconnectLocal,
  type AuthDisconnectOptions,
} from "./commands/auth-disconnect.js";
export { loadSessionToken, readSessionFileToken, envSessionToken, envSessionTokenForceActive, sessionTokenPrecedenceMode, saveSessionToken, sessionFilePath, skilletDir } from "./session-token.js";
export type { SessionTokenPrecedence } from "./session-token.js";
export {
  readActiveDeviceFile,
  saveDeviceToken,
  clearDeviceToken,
  deviceFilePath,
  type DeviceTokenFile,
} from "./device-token.js";
export {
  loadRegistryBearer,
  classifyRegistryBearer,
  type RegistryBearer,
  type RegistryBearerKind,
} from "./auth-token.js";
export { authStatus, type AuthStatus, type AuthStatusOptions } from "./commands/auth-status.js";
export {
  collectDoctorReport,
  DOCTOR_REPORT_SCHEMA,
  type DoctorReport,
  type DoctorReportOptions,
} from "./commands/doctor.js";
export { authConnect, type AuthConnectOptions, type AuthConnectResult } from "./commands/auth-connect.js";
export {
  authConnectPair,
  type AuthConnectPairOptions,
  type AuthConnectPairResult,
} from "./commands/auth-connect-pair.js";
export {
  mintPairCode,
  type MintPairCodeOptions,
  type MintPairCodeResult,
} from "./commands/mint-pair-code.js";
export {
  createOrg,
  inviteOrgMember,
  listOrgMembers,
  type TeamCreateOptions,
  type TeamCreateResult,
  type TeamInviteOptions,
  type TeamInviteResult,
  type TeamMembersOptions,
  type TeamMembersResult,
  type OrgMember,
  type PendingInvite,
} from "./commands/team.js";
export {
  createKit,
  addSkillToKit,
  inviteKitMember,
  listKitMembers,
  mintKitKey,
  removeKitMember,
  revokeKitKey,
  type KitCreateOptions,
  type KitCreateResult,
  type KitInviteResult,
  type KitKeyMintResult,
  type KitMembersResult,
} from "./commands/kit.js";
export {
  bootstrapLocalKit,
  type BootstrapLocalKitOptions,
  type BootstrapLocalKitResult,
  type BootstrapFailureStage,
} from "./commands/kit-bootstrap.js";
export {
  uploadLocalSkills,
  type UploadLocalSkillsOptions,
  type UploadLocalSkillsResult,
  type UploadProgressEvent,
} from "./commands/upload-skills.js";
export {
  subscribeKitByHandle,
  findKitByHandle,
  type SubscribeKitOptions,
  type SubscribeKitResult,
} from "./commands/kit-subscribe.js";
export {
  RegistryClient,
  RegistryError,
  parseSkillRef,
  formatSkillRef,
  parseKitHandle,
  KitHandleError,
  SkillRefError,
  type SkillRef,
  type KitHandle,
  type RegistryClientOptions,
  type RegistryManifest,
  type RegistryKitView,
  type VersionDetail,
  type CacheableResult,
  resolveDeviceScopedManifest,
  type DeviceScopedManifestResult,
  type ResolveDeviceScopedManifestOptions,
} from "./registry/index.js";
export {
  pullRegistryUpdates,
  type PullOptions,
  type PullOutcome,
  type PullStatus,
} from "./registry/pull.js";
export {
  computeDiff,
  checkLock,
  recordApproval,
  checkRejection,
  recordRejection,
  getLastApprovedVersion,
  defaultApprovalLockPath,
  promptApproval,
  promptQuarantineConsent,
  renderFindingsSummary,
  requiresQuarantineConsent,
  resolveTrustMode,
  loadPolicy,
  savePolicy,
  defaultPolicyPath,
  setGlobalDefault,
  setAuthorPolicy,
  setSkillPolicy,
  setKitPolicy,
  DEFAULT_POLICY,
} from "./trust/index.js";
export type { DiffApproval, DiffRejection } from "./trust/index.js";
export type {
  TrustMode,
  SourceClass,
  TrustPolicyFile,
  PolicyInput,
} from "./trust/index.js";
// Utilities exposed for adapter packages
export { sha256, hashRef, hashFile } from "./util/hash.js";
export {
  assertSafe,
  assertSafeSlug,
  assertNoPathEscape,
  validateMaterializationPath,
  validateAdapterRoot,
  validateProjectAdapterRoot,
  resolveAdapterRoot,
  MATERIALIZATION_ROOT_ALLOWLIST,
  PROJECT_TARGET_ALLOWLIST,
  HERMES_ENV_ROOT,
  HERMES_DEFAULT_HOME,
  CLAUDE_ENV_ROOT,
  isTccProtectedPath,
  TCC_PROTECTED_FOLDER_NAMES,
} from "./util/pathsafe.js";
export {
  // hermesProfileRoot lives in tcc-access (not pathsafe) so the gate can
  // consult the invocation-aware policy without an import cycle.
  hermesProfileRoot,
  isTccParkedPath,
  assessTccRoot,
  describeTccRoot,
  detectTccInvocation,
  setTccInvocation,
  resetTccInvocation,
  recordTccGrant,
  suspendTccGrant,
  tccGrantKey,
} from "./util/tcc-access.js";
export type {
  TccInvocation,
  TccInitiation,
  TccContext,
  TccRootAccess,
  TccRootDescription,
} from "./util/tcc-access.js";
export { atomicWrite } from "./util/atomic.js";
export {
  generateAuthorKey,
  saveAuthorKey,
  loadAuthorKey,
  loadAuthorKeyById,
  signBundle,
  verifyBundle,
  skilletReleasePublicKey,
} from "./signing/index.js";
export type { AuthorKey } from "./signing/index.js";
export {
  signatureBytes,
  signEnvelope,
  verifyEnvelope,
  SignatureError,
  SIG_ALG_ED25519,
} from "./signing/envelope.js";
export type {
  Signature,
  SigAlg,
  SignatureErrorCode,
} from "./signing/envelope.js";
export {
  defaultPinDir,
  loadPinnedKey,
  pinAuthorKey,
  forceRepinAuthorKey,
  resolveAuthorKey,
  listPinnedHandles,
  publicKeyFromBase64,
} from "./signing/pin.js";
export type { PinnedAuthorKey } from "./signing/pin.js";
export {
  parseAuthorKeyMismatch,
  compareAuthorPin,
  fetchServedAuthorKey,
  acceptAuthorKeyRotation,
  formatAuthorKeyMismatchHint,
  truncateKeyId,
} from "./signing/pin-recovery.js";
export type { AuthorKeyMismatchInfo, AuthorPinComparison } from "./signing/pin-recovery.js";
export {
  acceptAuthorKeyRotationWithInvalidation,
  invalidateAfterKeyRotation,
} from "./registry/rotation-invalidate.js";
export {
  mintDelegation,
  mintRevocation,
  deviceKeyIdFromPub,
  verifyDelegationCert,
  verifyDelegatedVersionSignature,
  DelegationError,
} from "./signing/delegation.js";
export type {
  DelegationErrorCode,
  MintDelegationOptions,
  MintRevocationOptions,
  VerifyDelegatedVersionOptions,
} from "./signing/delegation.js";
export {
  approveDevice,
  listDevices,
  renameDevice,
  revokeDevice,
  parseDevicePairing,
  DeviceCommandError,
} from "./commands/device.js";
export type {
  ApproveDeviceOptions,
  ApproveDeviceResult,
  RevokeDeviceOptions,
  RevokeDeviceResult,
  ConnectedDevicesResult,
} from "./commands/device.js";
export type { DelegationListItem, BearerDeviceListItem } from "./registry/client.js";
export {
  canonicalAdapterJson,
  deriveAdapterContentHash,
  verifyAdapterManifest,
  adapterManifestVerifyOptions,
  mergeAdapterManifest,
} from "./adapters/manifest.js";
export type {
  AdapterEntry,
  AdapterManifest,
  AdapterKind,
  AdapterLayout,
  VerifiedAdapterManifest,
} from "./adapters/manifest.js";
// Explicit named re-exports from ./lock.js so the new symbols
// (verifyLockedSignature, LockVerificationFinding) are unambiguously surfaced
// even though line 4's `export * from "./lock.js"` already re-exports them.
export {
  encodeLockFile,
  decodeLockFile,
  buildLockFile,
  readLockFile,
  verifyLockedSkill,
  verifyLockedSignature,
} from "./lock.js";
export type {
  LockVerificationFinding,
} from "./lock.js";
