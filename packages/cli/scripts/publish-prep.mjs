#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const backupPath = `${pkgPath}.publish-backup`;

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!existsSync(backupPath)) {
  writeFileSync(backupPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

const publishable = { ...pkg };
// Runtime deps are inlined by `pnpm bundle`; npm must not see workspace:* entries.
publishable.dependencies = {};
publishable.bin = { skillet: "./bin/skillet.js" };
publishable.files = Array.from(
  new Set([...(publishable.files ?? []), "bin/skillet.js"]),
);
const version = publishable.version;
publishable.optionalDependencies = {
  "@skilletmd/cli-darwin-arm64": version,
  "@skilletmd/cli-darwin-x64": version,
  "@skilletmd/cli-linux-x64": version,
  "@skilletmd/cli-linux-arm64": version,
  "@skilletmd/cli-win32-x64": version,
};

writeFileSync(pkgPath, JSON.stringify(publishable, null, 2) + "\n", "utf8");
console.log("Prepared package.json for npm publish (workspace deps stripped).");
