export {
  formatSkillRef,
  parseSkillRef,
  SkillRefError,
  type SkillRef,
} from './identifier.js';
export {
  parseKitHandle,
  KitHandleError,
  type KitHandle,
} from './kit-handle.js';
export {
  RegistryClient,
  RegistryError,
  type CacheableResult,
  type RegistryClientOptions,
  type RegistryManifest,
  type RegistryKitView,
  type VersionDetail,
} from './client.js';
export {
  resolveDeviceScopedManifest,
  type DeviceScopedManifestResult,
  type ResolveDeviceScopedManifestOptions,
} from './device-manifest.js';

// Re-export the Ed25519Envelope alias so downstream can type-check publish bodies.
export type { Signature as PublishSignature } from '../signing/envelope.js';
