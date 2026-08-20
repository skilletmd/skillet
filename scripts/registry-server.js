/**
 * Registry PM2 entry — loads packages/registry/.env, then starts the built Fastify app.
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const envPath = path.join(root, "packages/registry/.env");

/** PM2 / shell values for these keys win over .env (topology + runtime). */
const PM2_LOCKED_KEYS = new Set(["NODE_ENV", "PORT"]);

/** @param {string} filePath */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const locked = PM2_LOCKED_KEYS.has(key) && process.env[key];
    if (locked) continue;
    process.env[key] = val;
  }
}

loadDotEnv(envPath);

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.PORT = process.env.PORT || "3481";
process.env.HOST = process.env.HOST || "0.0.0.0";

const resendKey = String(process.env.RESEND_API_KEY ?? "").trim();
if (process.env.NODE_ENV === "production") {
  if (resendKey) {
    console.log(
      `[skillet registry] RESEND_API_KEY loaded (length ${resendKey.length})`,
    );
  } else {
    console.warn(
      "[skillet registry] RESEND_API_KEY is not set — magic-link email will fail",
    );
  }
}

const entry = path.join(root, "packages/registry/dist/main.js");

if (!fs.existsSync(entry)) {
  console.error("Registry not built. Run: pnpm --filter @skillet/registry build");
  process.exit(1);
}

import(pathToFileURL(entry).href).catch((err) => {
  console.error(err);
  process.exit(1);
});
