import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bake the package version in at build time so Settings can show it even in the
// browser mock (getVersion() only works inside the Tauri runtime).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// Tauri expects a fixed dev port and unminified, esnext output.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "esnext" },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
