// Preloaded before the registry test suite (see package.json "test" --import).
//
// A shell that has run the dev app exports SKILLET_WEB_URL / SKILLET_REGISTRY_URL
// / SKILLET_DIR pointing at localhost. SKILLET_WEB_URL is the sharpest hazard
// here: http-security.ts falls back to it for the CORS allowlist when
// SKILLET_CORS_ORIGINS is unset, and @fastify/cors then strict-preflight-400s
// bare OPTIONS — tests fail on a dev machine but pass in CI, which reads as a
// mystery flake. Scrub the ambient overrides so the suite is hermetic; tests
// that exercise these paths set the vars themselves (mirrors
// packages/cli/tests/scrub-env.mjs).
for (const key of [
  "SKILLET_WEB_URL",
  "SKILLET_REGISTRY_URL",
  "SKILLET_CORS_ORIGINS",
  "SKILLET_DIR",
]) {
  delete process.env[key];
}
