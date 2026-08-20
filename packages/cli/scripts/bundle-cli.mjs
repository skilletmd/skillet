#!/usr/bin/env node
import * as esbuild from "esbuild";
import { access, cp, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const entry = join(pkgRoot, "src", "index.ts");
const outfile = join(pkgRoot, "dist", "cli.cjs");
const pkgJson = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));

// Inline the route skill's SKILL.md into the bundle. pkg never snapshots
// dist/bundled-skills, so the packaged desktop sidecar can't read it from disk;
// baking it into cli.cjs is the only copy that reaches the sidecar. The on-disk
// copy is still shipped (below) for the npm CLI.
const routeSkillMd = await readFile(
  join(pkgRoot, "bundled-skills", "skillet-route", "SKILL.md"),
  "utf8",
);

const workspaceBuilt = join(pkgRoot, "node_modules", "@skillet", "core", "dist", "index.js");
try {
  await access(workspaceBuilt);
} catch {
  console.error(
    "Workspace packages are not built. Run `node packages/cli/scripts/build-cli-deps.mjs` from the repo root, then retry.",
  );
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      'const __esbuild_import_meta_url__ = require("node:url").pathToFileURL(__filename).href;',
    ].join("\n"),
  },
  define: {
    "import.meta.url": "__esbuild_import_meta_url__",
    __SKILLET_CLI_VERSION__: JSON.stringify(pkgJson.version),
    __SKILLET_ROUTE_SKILL_MD__: JSON.stringify(routeSkillMd),
  },
  packages: "bundle",
  logLevel: "info",
});

const bundledSrc = join(pkgRoot, "bundled-skills");
const bundledDest = join(pkgRoot, "dist", "bundled-skills");
await cp(bundledSrc, bundledDest, { recursive: true });

console.log(`Bundled CLI → ${outfile}`);
