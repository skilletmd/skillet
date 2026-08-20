/**
 * Artifact wire-format version — the shape of manifests, lockfiles, and local
 * kit state. Distinct from `/api/v1` (HTTP surface) and from per-skill
 * `version` integers inside a manifest.
 *
 * Bump only when the serialized contract changes in a breaking way. Clients
 * MUST reject unknown future versions; servers MUST emit the current version
 * on every manifest-shaped response.
 */
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

export type ArtifactSchemaVersion = typeof ARTIFACT_SCHEMA_VERSION;

const SUPPORTED = new Set<number>([ARTIFACT_SCHEMA_VERSION]);

/** True when `v` is a schema version this build can read. */
export function isSupportedArtifactSchemaVersion(
  v: unknown,
): v is ArtifactSchemaVersion {
  return typeof v === 'number' && SUPPORTED.has(v);
}

/**
 * Resolve schema_version from a wire payload. Missing field ⇒ legacy v1
 * (manifests that predated explicit stamping).
 */
export function resolveArtifactSchemaVersion(
  v: unknown,
  context: string,
): ArtifactSchemaVersion {
  if (v === undefined || v === null) return ARTIFACT_SCHEMA_VERSION;
  if (!isSupportedArtifactSchemaVersion(v)) {
    throw new Error(
      `${context}: unsupported artifact schema_version ${JSON.stringify(v)} (supported: ${ARTIFACT_SCHEMA_VERSION})`,
    );
  }
  return v;
}
