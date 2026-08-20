// Vitest setup: scrub ambient SKILLET_* dev-shell overrides so the suite is
// hermetic. transport/http.ts reads SKILLET_REGISTRY_URL and handler.ts reads
// SKILLET_WEB_URL — a shell that has pointed the desktop app at a local
// registry would silently redirect tests at localhost. Tests exercising the
// override paths set the vars themselves.
delete process.env["SKILLET_WEB_URL"];
delete process.env["SKILLET_REGISTRY_URL"];
delete process.env["SKILLET_DIR"];
