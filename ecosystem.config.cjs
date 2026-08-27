/**
 * PM2: Skillet production — web origin proxy + N Next workers + registry.
 *
 * Cloudflare terminates HTTPS and talks to WEB_PORT (default 3480). That port
 * is a tiny Node reverse proxy that round-robins to `next start` workers on
 * WEB_WORKER_BASE.. (default 3482, 3483) so logged-in browse stampedes are not
 * stuck behind a single event loop (CF ~20s → 503 while loopback still looked fine).
 *
 * Health:
 *   Web (public): GET http://127.0.0.1:3480/api/hc
 *   Registry:     GET http://127.0.0.1:3481/api/hc
 *
 * Usage:
 *   pnpm build && mkdir -p logs && pnpm pm2:start
 *   WEB_WORKERS=2 WEB_WORKER_BASE=3482 pnpm pm2:start
 *
 * Rollback to a single Next on 3480:
 *   WEB_WORKERS=1 pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env
 */
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const webRoot = path.join(root, "packages/web");
const registryRoot = path.join(root, "packages/registry");

/** Minimal .env parser — registry bootstrap reads packages/registry/.env itself. */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
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
    out[key] = val;
  }
  return out;
}

const registryDotEnv = loadDotEnv(path.join(registryRoot, ".env"));
const webDotEnv = loadDotEnv(path.join(webRoot, ".env"));

const webPublicPort = process.env.WEB_PORT ?? process.env.PORT ?? "3480";
const registryPort = process.env.REGISTRY_PORT ?? registryDotEnv.PORT ?? "3481";
const webWorkerBase = Number(process.env.WEB_WORKER_BASE ?? "3482");
const webWorkers = Math.max(1, Math.floor(Number(process.env.WEB_WORKERS ?? "2")) || 2);

// Inject the full registry .env into PM2 so secrets (RESEND_API_KEY, etc.) are
// present even when pm2 save/dump carries stale empty overrides.
const registryEnv = {
  ...registryDotEnv,
  NODE_ENV: "production",
  PORT: registryPort,
  HOST: registryDotEnv.HOST ?? "0.0.0.0",
  TRUST_PROXY: registryDotEnv.TRUST_PROXY ?? "1",
};

/** Shared Next worker env — web .env plus topology knobs. */
function webWorkerEnv(port) {
  return {
    ...webDotEnv,
    NODE_ENV: "production",
    PORT: String(port),
    // This origin sits behind Cloudflare (HTTPS terminated at the edge), so
    // cf-connecting-ip is trustworthy here. Opt in to forwarding it as
    // X-Forwarded-For so the registry's per-IP rate limit keys on the real
    // client, not this server's egress. MUST stay set on any Cloudflare-fronted
    // deployment; leave it unset on a non-proxied/local origin (forgeable).
    TRUST_CF_CONNECTING_IP: webDotEnv.TRUST_CF_CONNECTING_IP ?? "1",
    // CSP mode (src/proxy.ts). Enforcing after a clean surface sweep; set
    // "report-only" or "off" to roll back instantly (runtime env, no
    // rebuild — pm2 reload only). See packages/web/.env.example.
    WEB_CSP_MODE: webDotEnv.WEB_CSP_MODE ?? "enforce",
  };
}

function nextApp({ name, port }) {
  return {
    name,
    cwd: webRoot,
    script: path.join(webRoot, "node_modules/next/dist/bin/next"),
    args: `start -p ${port}`,
    instances: 1,
    exec_mode: "fork",
    interpreter: "node",
    env: webWorkerEnv(port),
    error_file: path.join(root, `logs/${name}-error.log`),
    out_file: path.join(root, `logs/${name}-out.log`),
    log_file: path.join(root, `logs/${name}-combined.log`),
    time: true,
    autorestart: true,
    max_restarts: 15,
    min_uptime: "10s",
    watch: false,
    max_memory_restart: "768M",
  };
}

const apps = [
  {
    name: "registry",
    cwd: root,
    script: path.join(root, "scripts/registry-server.js"),
    instances: 1,
    exec_mode: "fork",
    interpreter: "node",
    env: registryEnv,
    error_file: path.join(root, "logs/registry-error.log"),
    out_file: path.join(root, "logs/registry-out.log"),
    log_file: path.join(root, "logs/registry-combined.log"),
    time: true,
    autorestart: true,
    max_restarts: 15,
    min_uptime: "10s",
    watch: false,
    max_memory_restart: "512M",
  },
];

if (webWorkers === 1) {
  // Single Next on the public port — previous topology / easy rollback.
  apps.push(nextApp({ name: "web", port: webPublicPort }));
} else {
  for (let i = 0; i < webWorkers; i++) {
    const port = webWorkerBase + i;
    apps.push(nextApp({ name: `web-${i + 1}`, port }));
  }
  apps.push({
    name: "web",
    cwd: root,
    script: path.join(root, "scripts/web-origin-proxy.js"),
    instances: 1,
    exec_mode: "fork",
    interpreter: "node",
    env: {
      NODE_ENV: "production",
      WEB_PORT: String(webPublicPort),
      WEB_WORKER_BASE: String(webWorkerBase),
      WEB_WORKERS: String(webWorkers),
      WEB_WORKER_HOST: "127.0.0.1",
    },
    error_file: path.join(root, "logs/web-error.log"),
    out_file: path.join(root, "logs/web-out.log"),
    log_file: path.join(root, "logs/web-combined.log"),
    time: true,
    autorestart: true,
    max_restarts: 15,
    min_uptime: "10s",
    watch: false,
    max_memory_restart: "256M",
  });
}

/**
 * Absolute path to tsx's executable JS entry, resolved from the registry
 * package. Deliberately NOT `node_modules/.bin/tsx`: that shim is `#!/bin/sh`,
 * and PM2 runs this app with `interpreter: "node"`.
 */
function tsxCli() {
  const pkgPath = require.resolve("tsx/package.json", { paths: [registryRoot] });
  const { bin } = require(pkgPath);
  const rel = typeof bin === "string" ? bin : bin.tsx;
  return path.join(path.dirname(pkgPath), rel);
}


apps.push({
  // Nightly mirror ops: re-sync seeded + approved mirrors, then run the
  // quality-gated discovery pass into the review queue. One-shot process
  // relaunched by cron — autorestart stays OFF so a finished run doesn't
  // loop. Needs SKILLET_MIRROR_GITHUB_TOKEN / SKILLET_DISCOVERY_GITHUB_TOKEN
  // in packages/registry/.env for sane rate limits.
  // NOTE: `pm2 reload` does NOT pick up a new app — use `pm2 startOrReload`,
  // and PM2 runs a cron app once immediately on first start.
  name: "mirror-nightly",
  cwd: registryRoot,
  // tsx's REAL entry, not `node_modules/.bin/tsx`. The .bin path is a `#!/bin/sh`
  // shim, so pairing it with `interpreter: "node"` handed a shell script to
  // Node, which parsed `basedir=$(dirname ...)` as JavaScript and died with
  // `SyntaxError: missing ) after argument list` — instantly, on every single
  // 06:00 firing, since at least 2026-07-16. Nothing ever reached the sync
  // engine and every stdout log stayed 0 bytes.
  // Resolved through tsx's own package.json `bin` rather than a hardcoded path,
  // so a missing or moved tsx throws when PM2 LOADS this config instead of
  // failing silently once a day at 6am. (`tsx/dist/cli.mjs` is not an exported
  // subpath, so require.resolve cannot address it directly.)
  script: tsxCli(),
  args: "scripts/nightly-mirror-ops.ts",
  instances: 1,
  exec_mode: "fork",
  interpreter: "node",
  env: registryEnv,
  // Keep the hour in lockstep with SCHEDULED_HOUR in
  // scripts/nightly-mirror-ops.ts. PM2 also starts this app on every
  // `startOrReload`, so the script checks the clock to tell a deploy restart
  // from a scheduled one and exits immediately on the former.
  cron_restart: "0 6 * * *",
  autorestart: false,
  error_file: path.join(root, "logs/mirror-nightly-error.log"),
  out_file: path.join(root, "logs/mirror-nightly-out.log"),
  time: true,
  watch: false,
  max_memory_restart: "512M",
});

// Off unless a host asks for it. The sweep needs TWITTERAPI_IO_KEY to be worth
// running at all: without one the collector reaches Hacker News and nothing
// else, and it publishes that thin result as the day's edition. A host that has
// the key opts in with SKILLET_NEWS_NIGHTLY=1; everywhere else the brief is
// produced off-box and posted to /api/admin/stories.
if ((process.env.SKILLET_NEWS_NIGHTLY ?? webDotEnv.SKILLET_NEWS_NIGHTLY) === "1") {
apps.push({
  // Nightly Skillet Daily: collect the day's external signal, then write the
  // stories from it. One-shot process relaunched by cron — autorestart stays
  // OFF so a finished run doesn't loop. Plain node (these are .mjs, no tsx).
  // Needs TWITTERAPI_IO_KEY and ANTHROPIC_API_KEY in packages/web/.env.
  // NOTE: `pm2 reload` does NOT pick up a new app — use `pm2 startOrReload`,
  // and PM2 runs a cron app once immediately on first start.
  name: "news-nightly",
  cwd: webRoot,
  script: path.join(webRoot, "scripts/nightly-news.mjs"),
  instances: 1,
  exec_mode: "fork",
  interpreter: "node",
  env: {
    ...webDotEnv,
    NODE_ENV: "production",
    // The collector resolves posts against the registry running beside it.
    REGISTRY_URL: webDotEnv.REGISTRY_URL ?? `http://127.0.0.1:${registryPort}`,
    // The story writer and the registry's skill classifier are the same
    // account, and the key already lives in the registry .env. Fall back to it
    // rather than copying a secret into a second file, where the two would
    // drift and this job would no-op for a day before anyone noticed.
    ANTHROPIC_API_KEY: webDotEnv.ANTHROPIC_API_KEY ?? registryDotEnv.ANTHROPIC_API_KEY,
    // Optional. Skill cards are written from the skill's own README, fetched
    // over raw.githubusercontent, which needs no token. A token only adds the
    // tree API, which is what finds SKILL.md nested under a directory.
    GITHUB_TOKEN:
      webDotEnv.GITHUB_TOKEN ??
      registryDotEnv.SKILLET_MIRROR_GITHUB_TOKEN ??
      registryDotEnv.GITHUB_TOKEN,
    // Optional. Skill cards are written from the skill's own README, fetched
    // over raw.githubusercontent, which needs no token. A token only adds the
    // tree API, which is what finds SKILL.md nested under a directory.
    GITHUB_TOKEN:
      webDotEnv.GITHUB_TOKEN ??
      registryDotEnv.SKILLET_MIRROR_GITHUB_TOKEN ??
      registryDotEnv.GITHUB_TOKEN,
  },
  // An hour after mirror-nightly, so the day's newly mirrored skills are in the
  // registry before the collector tries to resolve posts against them. Keep in
  // lockstep with SCHEDULED_HOUR in packages/web/scripts/nightly-news.mjs.
  cron_restart: "0 7 * * *",
  autorestart: false,
  error_file: path.join(root, "logs/news-nightly-error.log"),
  out_file: path.join(root, "logs/news-nightly-out.log"),
  time: true,
  watch: false,
  max_memory_restart: "512M",
});
}

module.exports = { apps };
