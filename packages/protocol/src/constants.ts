// Wire-format constants for the Skillet registry protocol.
//
// PROTOCOL.md §0: "Transport: HTTPS, JSON bodies, UTF-8. Versioned under `/api/v1/`."
// PROTOCOL.md §11 (skillet.lock): `registry = "https://registry.skillet.md"`.
//
// The .dev domain that appeared in an earlier draft is superseded by the
// normative §11 spelling. Single source of truth for both the lockfile field
// and the default base URL is `skillet.md`.
export const REGISTRY_VERSION_PREFIX = '/api/v1';
export const REGISTRY_API_BASE = 'https://registry.skillet.md';

// Legacy: kept exported so callers that imported v1 directly still compile
// during the prefix migration. Remove once the registry client is
// fully on REGISTRY_VERSION_PREFIX.
/** @deprecated use REGISTRY_VERSION_PREFIX */
export const REGISTRY_VERSION = 'v1';

// PROTOCOL.md §6.1: `sync_interval_seconds` hints background-sync eligibility.
// Default cadence for caller-agnostic responses is 24h.
export const SYNC_INTERVAL_SECONDS_DEFAULT = 86400;
