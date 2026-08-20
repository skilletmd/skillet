import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // See packages/core/vitest.config.ts for the reasoning. Same failure here:
    // skill-kit-control needs ~440ms alone and timed out at 5s during a full
    // `pnpm -r test`, purely from load.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Map CSS imports to empty stubs so Vitest doesn't try to resolve them
      "highlight.js/styles/github.css": path.resolve(
        __dirname,
        "./tests/empty-module.ts"
      ),
    },
  },
});
