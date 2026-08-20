/**
 * `skillet publish [slug]` — sign and push kit skill(s) to the registry.
 *
 * Changes:
 *   - `slug` is now optional; when omitted all kit skills are published.
 *   - `visibility` defaults to 'private'; pass 'public' explicitly.
 *   - Identity is minted inline on first publish (no separate `skillet login` step).
 *
 * Flow (per skill):
 *   1. Load (or mint inline) the local identity.
 *   2. Read the skill bundle from the kit store.
 *   3. Run the warn-first privacy scan; HIGH findings hard-block per SPEC Safety §1/§8.
 *   4. Compute the canonical content hash (PROTOCOL §2.2), fetch the current
 *      manifest to learn the remote `latest_hash` (base), and reject
 *      client-side if our hash already matches (mirrors server idempotency).
 *   5. Sign via the §4 envelope (signEnvelope over the canonical hash string).
 *   6. Encode the bundle in wire format (files: BundleFiles) and POST /v1/skills.
 *      409 conflict → surface "local is behind remote" and refuse until the
 *      user re-fetches.
 *   7. Update the kit entry to record the registry source + author key id.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import matter from "gray-matter";
import {
  canonicalContentHash,
  encodeBundle,
  validateRequires,
  validateTriggers,
  RequiresError,
  TriggersError,
  isReservedSkillSlug,
} from "@skillet/protocol";
import { loadIdentity, saveIdentity, type Identity } from "../identity/index.js";
import {
  generateAuthorKey,
  saveAuthorKey,
  loadAuthorKey,
  loadAuthorKeyById,
} from "../signing/index.js";
import { signEnvelope, SIG_ALG_SESSION, type Signature } from "../signing/envelope.js";
import {
  readBundleFromSkillStore,
  readState,
  upsertSkill,
} from "../kit/store.js";
import { RegistryClient, RegistryError, type ScanWireFinding } from "../registry/client.js";
import { recordEvent, detectInitiator } from "../metrics.js";
import { REGISTRY_URL_DEFAULT } from "../kit/types.js";
import { REGISTRY_API } from "../registry-api.js";
import { loadSessionToken } from "../session-token.js";
import { claimHandle } from "./claim.js";

export type PublishErrorCode =
  | "not_logged_in"
  | "skill_not_found"
  | "not_your_skill"
  | "reserved_slug"
  | "invalid_requires"
  | "invalid_triggers"
  | "scan_blocked"
  | "identical_content"
  | "stale_base"
  | "manifest_fetch_failed"
  | "publish_failed";

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  readonly detail: unknown;

  constructor(message: string, code: PublishErrorCode, detail?: unknown) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.detail = detail;
  }
}

export interface PublishOptions {
  registryUrl?: string;
  configDir?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  /** Plain substrings appended to in-skill `.skilletignore-patterns` for the scan. */
  ignorePatterns?: string[];
  /** Visibility to publish with. Defaults to 'private'. */
  visibility?: 'private' | 'public';
  /**
   * Inline identity minting. When no identity exists and these are
   * provided, mint the identity automatically instead of erroring.
   */
  handle?: string;
  name?: string;
  /** Publish under verified session (web/desktop); no local Ed25519 signature. */
  sessionAuth?: boolean;
}

export interface PublishResult {
  hash: string;
  hashRef: string;
  versionUrl: string;
  /** Handle the skill published under (the session account or local identity). */
  owner: string;
  /** true when the server returned 200 (content was already known to the registry). */
  alreadyExists: boolean;
  /** Server-side scan verdict on the published version — the SOLE scan authority
   *  (KTD2). A `flagged` result publishes but is worth explaining; a real secret
   *  or quarantine aborts the publish upstream (422 `scan_blocked`) and never
   *  reaches here. Absent on an idempotent no-op. */
  serverScan?: { status: "clean" | "flagged" | "quarantined"; findings: ScanWireFinding[] };
  slug: string;
  /**
   * Non-fatal `requires:` schema notes (e.g. unknown keys). Surfaced back to
   * the author rather than swallowed — see AC #3.
   */
  requiresWarnings: string[];
  triggersWarnings: string[];
}

function defaultConfigDir(): string {
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
}

/**
 * Mint an identity inline on first publish. Generates a local keypair, registers
 * the author profile, and saves the identity file — all in one step so the user
 * doesn't need a separate `skillet login` command (SPEC identity-at-publish).
 */
async function mintIdentityInline(opts: {
  handle: string;
  name: string;
  registryUrl: string;
  configDir: string;
  fetchImpl?: typeof fetch;
}): Promise<Identity> {
  const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/;
  const handle = opts.handle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      `Invalid handle "${opts.handle}": must be 1-40 lowercase alphanumeric or hyphens.`,
    );
  }

  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  let key;
  try {
    key = await loadAuthorKey(opts.configDir);
  } catch {
    key = generateAuthorKey();
    await saveAuthorKey(key, opts.configDir);
  }

  try {
    await client.createProfile({ id: handle, name: opts.name });
  } catch (err) {
    // 409 = handle already registered; re-login accepted if it matches the local key.
    if (!(err instanceof RegistryError) || err.status !== 409) {
      throw err;
    }
  }

  const identity: Identity = {
    handle,
    keyId: key.keyId,
    registryUrl: opts.registryUrl,
    createdAt: new Date().toISOString(),
  };
  await saveIdentity(identity);

  const sessionToken = await loadSessionToken();
  if (sessionToken) {
    const claimResult = await claimHandle({
      handle,
      registryUrl: opts.registryUrl,
      token: sessionToken,
      configDir: opts.configDir,
      fetchImpl: opts.fetchImpl,
    });
    if (claimResult.primaryElsewhere) {
      throw new PublishError(
        `Primary signing key for @${handle} is on another machine. ` +
          `Publish from that device, skillet.md Studio, or approve this device from the primary.`,
        'not_logged_in',
      );
    }
  }

  return identity;
}

async function fetchSessionAccount(
  registryUrl: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<{ handle: string; authorKeyId: string | null }> {
  const res = await (fetchImpl ?? fetch)(`${registryUrl}${REGISTRY_API}/whoami`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new PublishError(
      'Could not resolve account from session. Sign in again and retry.',
      'not_logged_in',
    );
  }
  const body = (await res.json()) as { handle?: string | null; author_key_id?: string | null };
  if (!body.handle) {
    throw new PublishError(
      'Session has no claimed handle. Claim a username before publishing.',
      'not_logged_in',
    );
  }
  return {
    handle: body.handle,
    authorKeyId: body.author_key_id ?? null,
  };
}

export async function publish(
  slug: string,
  opts: PublishOptions = {}
): Promise<PublishResult> {
  return (await publishAll([slug], opts))[0]!;
}

/**
 * Bulk-publish multiple skills from the kit in one call.
 * Each skill is published independently; failures do not abort the batch.
 */
export async function publishAll(
  slugs: string[],
  opts: PublishOptions = {},
): Promise<PublishResult[]> {
  const configDir = opts.configDir ?? defaultConfigDir();
  const visibility = opts.visibility ?? 'private';
  const token = opts.token ?? ((await loadSessionToken()) || undefined);

  let publishHandle: string;
  let registryUrl: string;
  let signingKey: Awaited<ReturnType<typeof loadAuthorKeyById>> | null = null;
  let sessionAuthorKeyId: string | null = null;

  // Load the local signing identity BEFORE deciding the auth mode. The local
  // Ed25519 key is the user's *explicit* signing identity, so when it exists it
  // must win — we never silently downgrade to a session-attested publish just
  // because a (possibly stale) session token happens to be on disk. Doing the
  // sessionAuth decision before the identity load was the bug: it forced the
  // session path on token presence alone and broke local-key (v2) signatures.
  let identity: Identity | null = await loadIdentity();

  // Session auth is used only when the caller explicitly requests it (web/
  // desktop have no local key) OR when there is no local identity to sign with
  // and a session token is available as the fallback. If both a local identity
  // and a session token exist, the local identity wins.
  let sessionAuth = opts.sessionAuth === true || (!identity && !!token);

  if (sessionAuth) {
    if (!token) {
      throw new PublishError(
        'Session publish requires sign-in. Run `skillet connect` first.',
        'not_logged_in',
      );
    }
    registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/$/, '');
    const account = await fetchSessionAccount(registryUrl, token, opts.fetchImpl);
    publishHandle = account.handle;
    sessionAuthorKeyId = account.authorKeyId;
  } else {
    // identity was already loaded above; mint inline only when none exists.
    if (!identity) {
      if (opts.handle && opts.name) {
        const inlineRegistryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/$/, '');
        identity = await mintIdentityInline({
          handle: opts.handle,
          name: opts.name,
          registryUrl: inlineRegistryUrl,
          configDir,
          fetchImpl: opts.fetchImpl,
        });
      } else {
        throw new PublishError(
          'Not logged in. Run `skillet connect <code>` (code from skillet.md Settings), ' +
            'or pass --handle and --name to this command to claim your identity inline.',
          'not_logged_in',
        );
      }
    }
    publishHandle = identity.handle;
    registryUrl = (opts.registryUrl ?? identity.registryUrl).replace(/\/$/, '');
    signingKey = await loadAuthorKeyById(configDir, identity.keyId);
  }

  const state = await readState();

  const client = new RegistryClient({
    baseUrl: registryUrl,
    ...(token ? { token } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  const results: PublishResult[] = [];

  for (const slug of slugs) {
    // A promoted key (@handle/slug) is the caller's own published skill re-keyed
    // by sync. Registry-facing refs use the bare slug; entries keyed under a
    // DIFFERENT author are never publishable as your own.
    let bareSlug = slug;
    if (slug.startsWith('@')) {
      const sep = slug.indexOf('/');
      const keyOwner = sep > 1 ? slug.slice(1, sep) : '';
      if (sep < 0 || keyOwner !== publishHandle) {
        throw new PublishError(
          `Skill "${slug}" belongs to @${keyOwner || 'unknown'} — only your own skills can be published.`,
          'not_your_skill',
        );
      }
      bareSlug = slug.slice(sep + 1);
    }

    // Reject reserved slugs before any network/signing work: a skill slugged
    // kit/followers/following would publish but be unreachable at /{owner}/{slug}.
    if (isReservedSkillSlug(bareSlug)) {
      throw new PublishError(
        `Skill slug "${bareSlug}" is reserved and cannot be published. Rename the skill and try again.`,
        'reserved_slug',
      );
    }

    const entry = state.skills[slug];
    if (!entry) {
      throw new PublishError(
        `Skill "${slug}" not found in kit. Import it with \`skillet import <path>\` first.`,
        'skill_not_found',
      );
    }

    const bundle = await readBundleFromSkillStore(slug);

    // Enforce the `requires:` schema at the publish boundary.
    // Validate BEFORE signing/minting so a malformed dependency edge can never
    // reach a signed, content-addressed bundle (the re-mint cost this avoids).
    // selfRef is this skill's canonical ref so self-dependencies are rejected.
    const selfRef = `@${publishHandle}/${bareSlug}`;
    let requiresWarnings: string[];
    let triggersWarnings: string[];
    try {
      const entrypoint = bundle.get("SKILL.md");
      const fm = entrypoint
        ? (matter(Buffer.from(entrypoint).toString("utf8")).data as Record<string, unknown>)
        : {};
      requiresWarnings = validateRequires(fm["requires"], selfRef).warnings;
      triggersWarnings = validateTriggers(fm["triggers"]).warnings;
    } catch (err) {
      if (err instanceof RequiresError) {
        throw new PublishError(err.message, "invalid_requires");
      }
      if (err instanceof TriggersError) {
        throw new PublishError(err.message, "invalid_triggers");
      }
      throw err;
    }

    // No client-side privacy scan (KTD2). The registry publish route is the
    // single scan authority: its `secretsBlockingScan` + quarantine gate
    // (routes/skills.ts) aborts a real secret or confirmed-dangerous bundle
    // with a 422 `scan_blocked` BEFORE any row/blob is stored, and it uses a
    // benign-corpus so placeholder credentials in example docs pass. Running a
    // second, cruder regex scan here only diverged the verdict (desktop refused
    // what the web accepted); removing it makes desktop == web. KTD3: a real
    // secret's bytes now reach the server before it aborts — accepted, and
    // identical to how the web import already behaves.

    const contentHash = canonicalContentHash(bundle);

    let baseHash: string | null = null;
    try {
      const manifestResult = await client.getSkillManifest(`@${publishHandle}/${bareSlug}`);
      if (!manifestResult.notModified && manifestResult.value) {
        const remoteHash = manifestResult.value.latest_hash ?? null;
        if (remoteHash) {
          const normalised = remoteHash.startsWith('sha256:') ? remoteHash : `sha256:${remoteHash}`;
          if (normalised === contentHash) {
            // Same bytes — skip the round-trip only for private republishs.
            // Public (or visibility flips) still hit the registry so visibility updates.
            if (visibility === 'private') {
              results.push({
                hash: contentHash,
                hashRef: contentHash,
                versionUrl: `${REGISTRY_API}/skills/${publishHandle}/${bareSlug}/versions/${contentHash}`,
                owner: publishHandle,
                alreadyExists: true,
                slug,
                requiresWarnings,
                triggersWarnings,
              });
              continue;
            }
            baseHash = normalised;
          } else {
            baseHash = normalised;
          }
        }
      }
    } catch (err) {
      if (err instanceof RegistryError && err.status === 404) {
        baseHash = null;
      } else {
        throw new PublishError(
          `Failed to fetch manifest: ${(err as Error).message}`,
          'manifest_fetch_failed',
        );
      }
    }

    const files = encodeBundle(bundle);

    const sessionSignature = {
      alg: SIG_ALG_SESSION,
      key_id: sessionAuthorKeyId ?? '0'.repeat(64),
      sig: '',
    };

    let signature: Signature = sessionSignature;
    let authorKeyId = sessionAuthorKeyId;
    let authorPubBase64: string | null = null;

    if (!sessionAuth) {
      if (!signingKey || !identity) {
        throw new PublishError('Missing local signing key for CLI publish.', 'publish_failed');
      }
      signature = signEnvelope(contentHash, signingKey, {
        binding: {
          ref: `@${publishHandle}/${bareSlug}`,
          version: (entry.version ?? 0) + 1,
          authorKeyId: identity.keyId,
        },
      });
      const jwk = signingKey.publicKey.export({ format: 'jwk' }) as { x: string };
      authorPubBase64 = Buffer.from(jwk.x, 'base64url').toString('base64');
      authorKeyId = identity.keyId;
    }

    let publishResult: Awaited<ReturnType<typeof client.publishSkill>>;
    try {
      publishResult = await client.publishSkill({
        author: publishHandle,
        slug: bareSlug,
        files,
        base_hash: baseHash,
        ...(sessionAuth
          ? { publish_auth: 'session' as const }
          : { signature }),
        visibility,
      });
    } catch (err) {
      if (err instanceof RegistryError && err.status === 409) {
        throw new PublishError(
          err.message || 'Local is behind remote. Fetch the latest version and re-publish.',
          'stale_base',
          (err as RegistryError).body,
        );
      }
      // The publish gate hard-blocked a secret or quarantined verdict.
      // Carry the structured body (reason + findings) so the CLI renders the fix.
      if (err instanceof RegistryError && err.code === 'scan_blocked') {
        throw new PublishError(err.message, 'scan_blocked', err.body);
      }
      throw new PublishError(
        `Registry rejected publish: ${(err as Error).message}`,
        'publish_failed',
      );
    }

    if (sessionAuth && authorKeyId && !authorPubBase64) {
      try {
        const manifestRes = await client.getSkillManifest(`@${publishHandle}/${bareSlug}`);
        const manifest = manifestRes.value;
        if (manifest?.author_public_key) {
          authorPubBase64 = manifest.author_public_key;
        }
        if (manifest?.author_key_id) {
          authorKeyId = manifest.author_key_id;
        }
      } catch {
        // best-effort: session materialize still works via hash gate when keys absent
      }
    }

    await upsertSkill({
      ...entry,
      source: 'registry',
      registryUrl,
      ...(authorKeyId ? { authorKeyId } : {}),
      ...(authorPubBase64 ? { authorPubBase64 } : {}),
      signature,
      hash: contentHash,
      updatedAt: new Date().toISOString(),
    });

    const resultHash = publishResult.hash;
    const resultHashRef = resultHash.startsWith('sha256:') ? resultHash : `sha256:${resultHash}`;

    recordEvent('publish', detectInitiator(), {
      slug,
      hash: resultHashRef,
      alreadyExists: publishResult.already_exists,
    });

    results.push({
      hash: resultHash,
      hashRef: resultHashRef,
      versionUrl: publishResult.version_url,
      owner: publishHandle,
      alreadyExists: publishResult.already_exists,
      ...(publishResult.scan ? { serverScan: publishResult.scan } : {}),
      slug,
      requiresWarnings,
      triggersWarnings,
    });
  }

  return results;
}
