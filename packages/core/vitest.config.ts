import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/test-env-setup.ts"],
    // Vitest defaults to 5s, which these suites sit right on top of: they do
    // real filesystem work in temp dirs, and Windows fs calls are slow enough
    // that a test taking ~1.7s alone crosses 5s once `pnpm -r test` runs the
    // other packages alongside it. That failed the pre-commit hook at random,
    // on a different test each run, with nothing actually broken. A timeout is
    // a hang guard, not an assertion, so give it room the slowest CI runner can
    // live with rather than tuning each test.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // The cross-package e2e suites live in @skillet/core-e2e, not here: needing
    // a live registry gave core a devDependency on it and closed a
    // core -> registry -> mcp -> core cycle that broke build ordering. They run
    // via `pnpm --filter @skillet/core-e2e test:mysql`.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
