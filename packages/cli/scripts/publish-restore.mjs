#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const backupPath = `${pkgPath}.publish-backup`;

if (!existsSync(backupPath)) {
  console.warn("No publish backup found; package.json left unchanged.");
  process.exit(0);
}

writeFileSync(pkgPath, readFileSync(backupPath, "utf8"), "utf8");
unlinkSync(backupPath);
console.log("Restored package.json after publish.");
