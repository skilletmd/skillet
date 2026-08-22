// The public OpenAPI 3.1 description of the Skillet registry API.
//
// It lives in `@skillet/protocol` (not in the registry) because two processes
// serve the same document: the registry at `/openapi.json` and the web app at
// `https://skillet.md/openapi.json`. One document, one source of truth — a
// second hand-written copy in the web app would drift the moment a route moved.
//
// Scope: the ANONYMOUS read surface plus the authenticated operations an
// integrator actually calls. It is deliberately not a mirror of all ~175
// routes — device-sync, moderation queues, and account internals are private
// surfaces, and describing them would invite calls that will only ever 401.
// Every operation here carries a unique `operationId`, a `description`, typed
// parameters, and a response schema, which is what makes the document usable
// as an LLM function-calling source.
//
// Node-free by construction: this module is exposed via the
// `@skillet/protocol/openapi` SUBPATH and imported by the browser-facing web
// app, so it must never reach for `node:*` (see the barrel note in skill-id.ts).

import { REGISTRY_VERSION_PREFIX } from './constants.js';
import { OPENAPI_SCOPES, PROTECTED_RESOURCE_WELL_KNOWN } from './protected-resource.js';

/** Minimal structural type for the document. Kept local so the package takes
 *  no dependency on an OpenAPI types library for a document we author by hand. */
export type OpenApiDocument = {
  openapi: string;
  info: Record<string, unknown>;
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  externalDocs?: Record<string, unknown>;
};

export interface OpenApiOptions {
  /** Canonical site origin, e.g. `https://skillet.md`. No trailing slash. */
  siteUrl: string;
  /** Public registry origin, e.g. `https://registry.skillet.md`. No trailing slash. */
  registryUrl: string;
}

/** The scope catalog, re-exported so `@skillet/protocol/openapi` stays the
 *  import path every existing caller already uses. It is defined in
 *  `protected-resource.ts`, which is also what publishes it as RFC 9728
 *  `scopes_supported`. */
export { OPENAPI_SCOPES };

const trim = (raw: string): string => raw.trim().replace(/\/+$/, '');

const ERROR_REF = { $ref: '#/components/schemas/Error' } as const;

/** The error responses every operation can produce, spelled out so a function
 *  calling client knows what a failure looks like without a round trip. */
function errorResponses(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    '400': {
      description: 'The request was malformed (bad parameter, missing field).',
      content: { 'application/json': { schema: ERROR_REF } },
    },
    '404': {
      description: 'No such resource, or it is not readable by this caller.',
      content: { 'application/json': { schema: ERROR_REF } },
    },
    '429': {
      description: 'Rate limited. Retry after the window in `Retry-After`.',
      content: { 'application/json': { schema: ERROR_REF } },
    },
    ...extra,
  };
}

const PAGINATION_PARAMS = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Page size. Clamped server-side to 1-100.',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    description: 'Zero-based offset into the result set.',
    schema: { type: 'integer', minimum: 0, default: 0 },
  },
];

const AUTHOR_PARAM = {
  name: 'author',
  in: 'path',
  required: true,
  description: 'Owner handle, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-39 chars.',
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,38}$', examples: ['shadcn'] },
};

const SLUG_PARAM = {
  name: 'slug',
  in: 'path',
  required: true,
  description: 'Skill slug, e.g. `shadcn`. Lowercase alphanumerics and hyphens, 1-63 chars.',
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$', examples: ['shadcn'] },
};

const HASH_PARAM = {
  name: 'hash',
  in: 'path',
  required: true,
  description:
    'Content hash of a published version, with or without the `sha256:` prefix. Read it from `latest_hash` or the `versions[]` list on the skill detail response.',
  schema: {
    type: 'string',
    pattern: '^(sha256:)?[a-f0-9]{64}$',
    examples: ['sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686'],
  },
};

/**
 * The hand-authored document, before `buildOpenApiDocument` stamps the default
 * per-operation grant onto it. Kept separate so the stamping pass has exactly
 * one place to look and no operation can quietly opt out by omission.
 */
function baseOpenApiDocument(opts: OpenApiOptions): OpenApiDocument {
  const site = trim(opts.siteUrl);
  const registry = trim(opts.registryUrl);
  const prefix = REGISTRY_VERSION_PREFIX;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Skillet Registry API',
      version: '1.0.0',
      summary: 'Read and publish agent skills on Skillet.',
      description: [
        'Skillet is a registry for agent skills: a skill is a `SKILL.md` file (plus optional',
        'scripts, references, and assets) that an AI agent loads to gain a capability.',
        'Publish a skill once and it syncs to every agent runtime a person uses.',
        '',
        '**When an agent should call this API**',
        '',
        '- Find an existing skill for a task before writing instructions from scratch:',
        '  `GET /search?q=...` or `GET /skills?q=...`.',
        "- Read a specific skill's instructions to perform a task: `GET /skills/{author}/{slug}`",
        '  then `GET /skills/{author}/{slug}/versions/{hash}/file?path=SKILL.md`.',
        "- Look up who publishes in a domain: `GET /discover/people` or `GET /profiles/{author}`.",
        '- Check what a skill is allowed to do before running it: `GET /skills/{author}/{slug}/versions/{hash}/scan`.',
        '',
        '**Auth**',
        '',
        'Every read operation listed here is anonymous: no key, no signup, no sales call. Publishing',
        'and device sync use a bearer token whose class fixes its scopes (see `securitySchemes`); a',
        'token can never widen its own scope. Mint one yourself in seconds — sign in at the site and',
        'pair a machine with the `skilletmd` CLI (`npx skilletmd`), or enable a read-only MCP link at',
        'Settings → Account. Scopes are also published machine-readably as RFC 9728 protected-resource',
        `metadata at ${registry}${PROTECTED_RESOURCE_WELL_KNOWN.api}, which is where the`,
        '`WWW-Authenticate` header on a `401` points.',
        '',
        '**Rate limits**',
        '',
'Metered responses carry the RateLimit header fields. `RateLimit-Limit` and `RateLimit-Policy`',
        'describe the policy and are always present. `RateLimit-Remaining`, `RateLimit-Reset`, and the',
        'combined `RateLimit` field describe YOUR bucket, so they are sent only when the response is',
        'not shared-cacheable: catalog reads sit in a CDN edge cache, where one caller\'s count would',
        'be served to the next. Pace against `RateLimit-Policy`; read the live counter from any',
        'uncached response or from the `429`, which is always `no-store` and adds `Retry-After`.',
        '',
        '**Versioning and deprecation**',
        '',
        `The version lives in the URL path (\`${prefix}\`). A path under that prefix never changes`,
        'meaning: breaking changes ship as a new prefix, and the old one keeps answering. When an',
        'endpoint is on its way out it answers with `Deprecation` (RFC 9745) and a',
        '`Link: <...>; rel="deprecation"` pointing at the policy page, and a `Sunset` (RFC 8594) date',
        'once one is set. Nothing is removed without that header appearing first.',
        '',
        '**Errors**',
        '',
        'Failures are always JSON with the `Error` schema below: a stable `code`, a human',
        '`message`, and a `docs` URL that resolves the failure. Never an HTML page.',
      ].join('\n'),
      // No `email` on purpose. Addresses on this site render through
      // ObfuscatedEmail and never appear in server-rendered output; a spec is
      // fetched by every crawler alive, so publishing one here would undo that.
      // The contact page carries the routes.
      contact: {
        name: 'Skillet',
        url: `${site}/contact`,
      },
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
      termsOfService: `${site}/legal/terms`,
      // Extension members. The prose above says the same things, but an agent
      // deciding whether it can integrate unattended needs to branch on values,
      // not parse English.
      'x-onboarding': {
        anonymous_reads: true,
        free_tier: true,
        self_serve_credentials: true,
        credential_url: `${site}/docs/api#auth`,
        cli: 'npx skilletmd',
        contact_sales_required: false,
      },
      'x-rate-limit-headers': {
        limit: 'RateLimit-Limit',
        remaining: 'RateLimit-Remaining',
        reset: 'RateLimit-Reset',
        policy: 'RateLimit-Policy',
        combined: 'RateLimit',
        retry_after: 'Retry-After',
        // Which of the above survive a shared cache. The policy fields are the
        // same for every caller; the counters are not, and are withheld rather
        // than served stale from a CDN edge.
        always_present: ['RateLimit-Limit', 'RateLimit-Policy'],
        uncached_only: ['RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit'],
        documentation: `${site}/docs/api#rate-limits`,
      },
      'x-versioning': {
        strategy: 'url-path',
        current: prefix,
        deprecation_header: 'Deprecation',
        sunset_header: 'Sunset',
        policy_url: `${site}/docs/versioning`,
      },
      'x-protected-resource-metadata': `${registry}${PROTECTED_RESOURCE_WELL_KNOWN.api}`,
    },
    servers: [
      {
        url: `${site}${prefix}`,
        description: 'Public read-only mirror on the canonical site origin. GET and HEAD only.',
      },
      {
        url: `${registry}${prefix}`,
        description: 'Registry origin. Full surface, including authenticated writes.',
      },
    ],
    tags: [
      { name: 'skills', description: 'The skill catalog: search, detail, versions, and content.' },
      { name: 'discovery', description: 'Cross-catalog search and browse feeds.' },
      { name: 'people', description: 'Author and team profiles, and the trust graph.' },
      { name: 'kits', description: 'Kits: named, versioned collections of skills.' },
      { name: 'registry', description: 'Registry-wide status and enforcement records.' },
    ],
    externalDocs: {
      description: 'Skillet API guide, auth scopes, and MCP setup',
      url: `${site}/docs/api`,
    },
    security: [{}],
    paths: {
      '/skills': {
        get: {
          operationId: 'listSkills',
          tags: ['skills'],
          summary: 'List published skills',
          description:
            'The public skill catalog, newest first by default. Use `q` for a substring match over name and description, or `category` to narrow to one domain. Returns only public skills for an anonymous caller.',
          parameters: [
            ...PAGINATION_PARAMS,
            {
              name: 'q',
              in: 'query',
              required: false,
              description: 'Free-text filter over skill name and description.',
              schema: { type: 'string' },
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              description:
                'One category key, or a comma-separated list. Unknown keys are ignored rather than widening the query.',
              schema: { type: 'string', examples: ['frontend', 'devops,backend'] },
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              description: '`new` for most recently published, `alpha` for name order.',
              schema: { type: 'string', enum: ['new', 'alpha'] },
            },
          ],
          responses: {
            '200': {
              description: 'A page of catalog entries.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SkillListPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}': {
        get: {
          operationId: 'getSkill',
          tags: ['skills'],
          summary: 'Get one skill',
          description:
            "A skill's full public record: description, category, latest version hash, the version list, scan and signature status, provenance, and token cost. Fetch this before reading skill content so you know which `hash` to request.",
          parameters: [AUTHOR_PARAM, SLUG_PARAM],
          responses: {
            '200': {
              description: 'The skill detail record.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SkillDetail' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}/manifest': {
        get: {
          operationId: 'getSkillManifest',
          tags: ['skills'],
          summary: 'Get the latest version manifest',
          description:
            'The per-file manifest of the latest published version: every bundle path with its size and content hash. Use it to verify a download or to decide which files are worth fetching.',
          parameters: [AUTHOR_PARAM, SLUG_PARAM],
          responses: {
            '200': {
              description: 'The manifest for the latest published version.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/VersionManifest' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}/versions/{hash}/files': {
        get: {
          operationId: 'listSkillVersionFiles',
          tags: ['skills'],
          summary: 'List the files in a version',
          description:
            'Every file in one published version, with size and kind. `SKILL.md` is always present; supporting `scripts/`, `references/`, and `assets/` files appear when the author bundled them.',
          parameters: [AUTHOR_PARAM, SLUG_PARAM, HASH_PARAM],
          responses: {
            '200': {
              description: 'The file listing for that version.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/VersionFileList' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}/versions/{hash}/file': {
        get: {
          operationId: 'getSkillVersionFile',
          tags: ['skills'],
          summary: 'Read one file from a version',
          description:
            'The decoded text of a single bundle file. Request `path=SKILL.md` to read the instructions an agent loads. Responses carry a strong ETag; send `If-None-Match` to get a 304 instead of a re-download.',
          parameters: [
            AUTHOR_PARAM,
            SLUG_PARAM,
            HASH_PARAM,
            {
              name: 'path',
              in: 'query',
              required: true,
              description: 'Bundle-relative file path, e.g. `SKILL.md` or `references/API.md`.',
              schema: { type: 'string', examples: ['SKILL.md'] },
            },
          ],
          responses: {
            '200': {
              description: 'The file, decoded as text.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/VersionFile' } },
              },
            },
            '304': { description: 'The caller already has this exact version of the file.' },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}/versions/{hash}/scan': {
        get: {
          operationId: 'getSkillVersionScan',
          tags: ['skills'],
          summary: 'Get the harm-scan verdict for a version',
          description:
            "The registry's static scan of a version: an overall verdict plus the findings behind it. Read this before running a third-party skill; `quarantined` means the registry refuses to serve the content at all.",
          parameters: [AUTHOR_PARAM, SLUG_PARAM, HASH_PARAM],
          responses: {
            '200': {
              description: 'The scan record for that version.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ScanReport' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/skills/{author}/{slug}/kits': {
        get: {
          operationId: 'listKitsForSkill',
          tags: ['skills'],
          summary: 'List the kits a skill belongs to',
          description:
            'Public kits that include this skill. Useful for finding curated collections around a capability you already trust.',
          parameters: [AUTHOR_PARAM, SLUG_PARAM],
          responses: {
            '200': {
              description: 'The kits containing this skill.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { kits: { type: 'array', items: { $ref: '#/components/schemas/KitSummary' } } },
                    required: ['kits'],
                  },
                },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/search': {
        get: {
          operationId: 'search',
          tags: ['discovery'],
          summary: 'Search skills, kits, and people',
          description:
            'One query across every public object type. This is the right first call for "is there already a skill for X" — it ranks skills, kits, authors, and teams together.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'The search query. An empty query returns no results.',
              schema: { type: 'string', minLength: 1, examples: ['code review'] },
            },
            {
              name: 'types',
              in: 'query',
              required: false,
              description:
                'Comma-separated object types to include. Defaults to all of `skills,kits,people`.',
              schema: { type: 'string', examples: ['skills', 'skills,people'] },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum results per type.',
              schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
          ],
          responses: {
            '200': {
              description: 'Ranked results grouped by type.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SearchResults' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/discover/kits': {
        get: {
          operationId: 'listKits',
          tags: ['kits'],
          summary: 'Browse public kits',
          description:
            'The public kit catalog. A kit is a named, versioned collection of skills that a person or team maintains; subscribing to one keeps every member skill current.',
          parameters: [
            ...PAGINATION_PARAMS,
            {
              name: 'q',
              in: 'query',
              required: false,
              description: 'Free-text filter over kit name and description.',
              schema: { type: 'string' },
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              description: 'One category key, or a comma-separated list.',
              schema: { type: 'string' },
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              description: '`new` for most recently published, `alpha` for name order.',
              schema: { type: 'string', enum: ['new', 'alpha'] },
            },
          ],
          responses: {
            '200': {
              description: 'A page of public kits.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/KitListPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/discover/people': {
        get: {
          operationId: 'listPeople',
          tags: ['people'],
          summary: 'Browse authors and teams',
          description:
            'Public profiles that have published at least one skill, with the categories they publish in. Use it to answer "who is worth following for X".',
          parameters: [
            ...PAGINATION_PARAMS,
            {
              name: 'q',
              in: 'query',
              required: false,
              description: 'Free-text filter over handle, display name, and bio.',
              schema: { type: 'string' },
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              description: 'One category key, or a comma-separated list.',
              schema: { type: 'string' },
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              description: 'Ordering: `followers`, `new`, or `alpha`.',
              schema: { type: 'string', enum: ['followers', 'new', 'alpha'] },
            },
          ],
          responses: {
            '200': {
              description: 'A page of public profiles.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PeopleListPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/discover/feed': {
        get: {
          operationId: 'listActivity',
          tags: ['discovery'],
          summary: 'Read the public activity feed',
          description:
            'Registry-wide public activity — publishes, new kits, new profiles — newest first. Poll it to track what changed since a previous read.',
          parameters: PAGINATION_PARAMS,
          responses: {
            '200': {
              description: 'A page of public activity events.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ActivityPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/profiles/{author}': {
        get: {
          operationId: 'getProfile',
          tags: ['people'],
          summary: 'Get an author or team profile',
          description:
            "A profile's public record: display name, bio, avatar, follower counts, public adopter count, and every public skill they publish.",
          parameters: [AUTHOR_PARAM],
          responses: {
            '200': {
              description: 'The profile record.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Profile' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/profiles/{author}/followers': {
        get: {
          operationId: 'listFollowers',
          tags: ['people'],
          summary: 'List a profile’s followers',
          description: 'Public handles that follow this profile.',
          parameters: [AUTHOR_PARAM, ...PAGINATION_PARAMS],
          responses: {
            '200': {
              description: 'A page of follower handles.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/HandleListPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/profiles/{author}/following': {
        get: {
          operationId: 'listFollowing',
          tags: ['people'],
          summary: 'List who a profile follows',
          description: 'Public handles this profile follows.',
          parameters: [AUTHOR_PARAM, ...PAGINATION_PARAMS],
          responses: {
            '200': {
              description: 'A page of followed handles.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/HandleListPage' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/kits/by-handle/{owner}/{slug}': {
        get: {
          operationId: 'getKitByHandle',
          tags: ['kits'],
          summary: 'Get a kit by owner and slug',
          description:
            'One public kit and its member skills, addressed the same way its web page is (`/{owner}/kit/{slug}`).',
          parameters: [
            {
              ...AUTHOR_PARAM,
              name: 'owner',
              description: 'Handle of the person or team that owns the kit.',
            },
            {
              ...SLUG_PARAM,
              description: 'Kit slug.',
              schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$', examples: ['kit'] },
            },
          ],
          responses: {
            '200': {
              description: 'The kit and its members.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Kit' } } },
            },
            ...errorResponses(),
          },
        },
      },
      '/stats': {
        get: {
          operationId: 'getRegistryStats',
          tags: ['registry'],
          summary: 'Get registry-wide totals',
          description:
            'Public aggregates: skill, kit, author, and device counts, plus recent publish volume. No identity is exposed.',
          responses: {
            '200': {
              description: 'Registry totals.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/RegistryStats' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/moderation': {
        get: {
          operationId: 'listModerationActions',
          tags: ['registry'],
          summary: 'Read the public moderation log',
          description:
            'Currently-active enforcement against skills and accounts. Published so a downstream consumer can independently check whether something it cached has since been removed.',
          responses: {
            '200': {
              description: 'Active enforcement records.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ModerationLog' } },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/whoami': {
        get: {
          operationId: 'whoami',
          tags: ['registry'],
          summary: 'Identify the calling token',
          description:
            'Resolves the bearer token to its principal and the scopes it carries. Anonymous callers get `{"authenticated": false}` rather than a 401, so it doubles as a cheap credential check.',
          security: [{}, { bearerAuth: ['read'] }],
          responses: {
            '200': {
              description: 'The caller identity and granted scopes.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/WhoAmI' } } },
            },
            ...errorResponses(),
          },
        },
      },
      '/sync/manifest': {
        get: {
          operationId: 'getSyncManifest',
          tags: ['registry'],
          summary: 'Get the sync manifest for a paired device',
          description:
            "Everything a device is entitled to hold: each skill's approved version and content hash. Requires a device or session token with the `sync` scope. Send `If-None-Match` with the previous ETag to poll cheaply.",
          security: [{ bearerAuth: ['sync'] }],
          responses: {
            '200': {
              description: 'The manifest of approved skill versions for this device.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SyncManifest' } },
              },
            },
            '304': { description: 'Nothing changed since the ETag the caller sent.' },
            '401': {
              description: 'Missing, expired, or revoked token.',
              content: { 'application/json': { schema: ERROR_REF } },
            },
            '403': {
              description: 'The token is valid but lacks the `sync` scope.',
              content: { 'application/json': { schema: ERROR_REF } },
            },
            ...errorResponses(),
          },
        },
      },
      '/mcp': {
        post: {
          operationId: 'callMcp',
          tags: ['registry'],
          summary: 'Call the hosted MCP server',
          description:
            "JSON-RPC 2.0 over Streamable HTTP. Exposes the caller's kit as MCP tools (`list_skills`, `get_skill`, plus `search`/`fetch` aliases for deep-research clients). Read-only: an MCP token can never publish or sync-write. Enable the link at Settings → Account on the site, then point a client at it.",
          security: [{ bearerAuth: ['read'] }],
          requestBody: {
            required: true,
            description: 'A JSON-RPC 2.0 request or notification.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/JsonRpcRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'The JSON-RPC response.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/JsonRpcResponse' } },
              },
            },
            '202': { description: 'A JSON-RPC notification was accepted; no body.' },
            '401': {
              description: 'Missing, disabled, or revoked MCP token.',
              content: { 'application/json': { schema: ERROR_REF } },
            },
            ...errorResponses(),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: [
            'A Skillet bearer token. The class prefix fixes the scopes; a token cannot widen its own grant.',
            '',
            '| Prefix | Class | Scopes |',
            '| --- | --- | --- |',
            '| `skillet_s_` | user session | `read`, `sync`, `publish`, `claim` |',
            '| `skillet_d_` | paired device | `read`, `sync` |',
            '| `skillet_k_` | kit key | `read`, `sync` (one kit only) |',
            '| `skillet_m_` | hosted MCP link | `read` |',
            '',
            'Request the narrowest class that does the job: an integration that only reads a kit should hold a kit key, not a session token.',
          ].join('\n'),
          // The named grants, in the field a machine reads. OpenAPI only models
          // `scopes` under an `oauth2` flow, and Skillet runs no authorization
          // server to put there, so the catalog is published as an extension
          // here and — canonically — as `scopes_supported` in the RFC 9728
          // document at `x-protected-resource-metadata`.
          'x-scopes': { ...OPENAPI_SCOPES },
          'x-protected-resource-metadata': `${registry}${PROTECTED_RESOURCE_WELL_KNOWN.api}`,
        },
        mcpLinkToken: {
          type: 'apiKey',
          in: 'path',
          name: 'token',
          description:
            'The hosted MCP link embeds its `skillet_m_` token in the URL (`/mcp/{token}`) for clients that cannot set an Authorization header. Read-only, revocable by regenerating the link.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          description:
            'The shape of every failure response. `code` is stable and safe to branch on; `message` is for humans; `docs` points at the page that resolves it.',
          properties: {
            error: {
              type: 'string',
              description: 'Short reason phrase, e.g. `Not Found`.',
              examples: ['Not Found'],
            },
            code: {
              type: 'string',
              description: 'Stable machine-readable error code, e.g. `skill_not_found`.',
              examples: ['skill_not_found'],
            },
            message: {
              type: 'string',
              description: 'Human-readable explanation.',
              examples: ['Skill not found'],
            },
            statusCode: { type: 'integer', description: 'The HTTP status, repeated in the body.' },
            docs: {
              type: 'string',
              format: 'uri',
              description: 'Documentation that explains how to resolve this error.',
            },
            request_id: {
              type: 'string',
              description: 'Opaque id correlating this failure to the server log. Present on 5xx.',
            },
          },
          required: ['error'],
        },
        SkillSummary: {
          type: 'object',
          description: 'A catalog entry. Enough to decide whether to fetch the full skill.',
          properties: {
            author: { type: 'string', description: 'Owner handle.', examples: ['shadcn'] },
            slug: { type: 'string', description: 'Skill slug.', examples: ['shadcn'] },
            skill_id: {
              type: 'string',
              description: 'Canonical `owner:slug` identifier.',
              examples: ['shadcn:shadcn'],
            },
            description: {
              type: 'string',
              description: 'What the skill does and when to use it.',
              examples: ['Manages shadcn components and projects: adding, searching, fixing, and composing UI.'],
            },
            visibility: { type: 'string', enum: ['public', 'private'] },
            latest_hash: {
              type: 'string',
              description: 'Content hash of the latest version.',
              examples: ['sha256:c57e3cc8688fe5f0956c8e91ee02d1ee97fb5b0e8115e2d6ca6447c1ade69686'],
            },
            version: { type: 'integer', description: 'Monotonic version number.', examples: [3] },
            version_label: { type: 'string', description: 'Semver-style display label.', examples: ['1.2.0'] },
            install_count: {
              type: 'integer',
              description: 'Times this skill has been installed.',
              examples: [412],
            },
            created_at: {
              type: 'integer',
              description: 'Unix seconds when first published.',
              examples: [1787163766],
            },
            category: {
              type: ['string', 'null'],
              description: 'Category key, e.g. `frontend`.',
              examples: ['frontend'],
            },
            signatureStatus: {
              type: 'string',
              enum: ['verified', 'unverified', 'invalid'],
              description: 'Whether the latest version carries a valid author signature.',
            },
            scanStatus: {
              type: 'string',
              enum: ['clean', 'flagged', 'quarantined', 'pending', 'unknown'],
              description: 'Harm-scan verdict for the latest version.',
            },
            moderationStatus: {
              type: 'string',
              description: 'Active enforcement, or `none`.',
              examples: ['none'],
            },
            deprecated: { type: 'boolean', description: 'The author has retired this skill.' },
            used_by: {
              type: 'array',
              items: { type: 'string', examples: ['gtm'] },
              description: 'Handles of public adopters.',
            },
            used_by_count: {
              type: 'integer',
              description: 'Number of public adopters.',
              examples: [12],
            },
          },
          required: ['author', 'slug', 'skill_id', 'description', 'visibility'],
        },
        SkillDetail: {
          allOf: [
            { $ref: '#/components/schemas/SkillSummary' },
            {
              type: 'object',
              properties: {
                versions: {
                  type: 'array',
                  description: 'Every published version, newest first.',
                  items: {
                    type: 'object',
                    properties: {
                      hash: { type: 'string' },
                      published_at: { type: 'integer' },
                      version_label: { type: 'string' },
                    },
                    required: ['hash', 'published_at'],
                  },
                },
                author_name: { type: ['string', 'null'], description: 'Owner display name.' },
                author_avatar_url: { type: ['string', 'null'], format: 'uri' },
                author_public_key: {
                  type: ['string', 'null'],
                  description: 'Base64 Ed25519 public key the signature chains to.',
                },
                manifest_url: {
                  type: 'string',
                  description: 'Path to the per-file manifest for the latest version.',
                },
                is_mirror: {
                  type: 'boolean',
                  description: 'True when the skill mirrors an upstream repository.',
                },
                mirror_source_url: { type: ['string', 'null'], format: 'uri' },
                mirror_license: {
                  type: ['string', 'null'],
                  description: 'SPDX identifier declared upstream.',
                },
                triggers: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Phrases the author expects to activate this skill.',
                },
                token_count: {
                  type: 'integer',
                  description: 'Approximate tokens the full SKILL.md costs to load.',
                },
                deprecation_message: { type: ['string', 'null'] },
              },
            },
          ],
        },
        SkillListPage: {
          type: 'object',
          properties: {
            skills: { type: 'array', items: { $ref: '#/components/schemas/SkillSummary' } },
            total: {
              type: 'integer',
              description: 'Total matches, ignoring pagination.',
              examples: [1145],
            },
            limit: { type: 'integer', examples: [50] },
            offset: { type: 'integer', examples: [0] },
          },
          required: ['skills', 'total', 'limit', 'offset'],
        },
        FileMeta: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Bundle-relative path.' },
            size: { type: 'integer', description: 'Bytes.' },
            hash: { type: 'string', description: 'Content hash of this file.' },
          },
          required: ['path'],
        },
        VersionManifest: {
          type: 'object',
          properties: {
            schema_version: { type: 'integer' },
            hash: { type: 'string', description: 'Content hash of the version.' },
            author: { type: 'string' },
            slug: { type: 'string' },
            files: { type: 'array', items: { $ref: '#/components/schemas/FileMeta' } },
          },
          required: ['hash', 'author', 'slug', 'files'],
        },
        VersionFileList: {
          type: 'object',
          properties: {
            schema_version: { type: 'integer' },
            hash: { type: 'string' },
            author: { type: 'string' },
            slug: { type: 'string' },
            files: { type: 'array', items: { $ref: '#/components/schemas/FileMeta' } },
          },
          required: ['hash', 'author', 'slug', 'files'],
        },
        VersionFile: {
          type: 'object',
          properties: {
            schema_version: { type: 'integer' },
            hash: { type: 'string' },
            author: { type: 'string' },
            slug: { type: 'string' },
            path: { type: 'string' },
            size: { type: 'integer' },
            text: { type: 'string', description: 'The decoded file contents.' },
          },
          required: ['hash', 'author', 'slug', 'path'],
        },
        ScanReport: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
            status: {
              type: 'string',
              enum: ['clean', 'flagged', 'quarantined', 'pending', 'unknown'],
              description: 'The verdict. `quarantined` content is never served.',
            },
            corpus_version: {
              type: 'integer',
              description: 'Detector corpus the verdict was produced against.',
            },
            findings: {
              type: 'array',
              description: 'Individual detector hits behind the verdict.',
              items: {
                type: 'object',
                properties: {
                  detector: { type: 'string' },
                  severity: { type: 'string' },
                  path: { type: 'string' },
                  line: { type: 'integer' },
                  message: { type: 'string' },
                },
                required: ['detector', 'severity'],
              },
            },
          },
          required: ['status'],
        },
        KitSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            owner: { type: 'string', description: 'Handle of the owning person or team.' },
            slug: { type: 'string' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            skill_count: { type: 'integer' },
            subscriber_count: { type: 'integer' },
            category: { type: ['string', 'null'] },
          },
          required: ['owner', 'name'],
        },
        Kit: {
          allOf: [
            { $ref: '#/components/schemas/KitSummary' },
            {
              type: 'object',
              properties: {
                skills: {
                  type: 'array',
                  description: 'Member skills, in kit order.',
                  items: { $ref: '#/components/schemas/SkillSummary' },
                },
                version: { type: 'integer', description: 'Published kit version.' },
              },
            },
          ],
        },
        KitListPage: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/KitSummary' } },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
          required: ['items', 'total', 'limit', 'offset'],
        },
        Profile: {
          type: 'object',
          properties: {
            handle: { type: 'string', examples: ['shadcn'] },
            displayName: { type: ['string', 'null'], examples: ['shadcn/ui'] },
            bio: { type: ['string', 'null'], examples: ['Official shadcn/ui workflow.'] },
            avatarUrl: { type: ['string', 'null'], format: 'uri' },
            kind: { type: 'string', enum: ['user', 'team'] },
            followers: { type: 'integer' },
            following: { type: 'integer' },
            totalInstalls: {
              type: 'integer',
              description:
                'Public adopters (kit saves plus subscriptions), not raw installs — installer identity is private.',
            },
            skills: { type: 'array', items: { $ref: '#/components/schemas/SkillSummary' } },
          },
          required: ['handle'],
        },
        PeopleListPage: {
          type: 'object',
          properties: {
            people: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  handle: { type: 'string' },
                  name: { type: ['string', 'null'] },
                  bio: { type: ['string', 'null'] },
                  avatar_url: { type: ['string', 'null'], format: 'uri' },
                  followers: { type: 'integer' },
                  public_skills: { type: 'integer' },
                  kits: { type: 'integer' },
                  categories: { type: 'array', items: { type: 'string' } },
                  created_at: { type: 'integer' },
                },
                required: ['handle'],
              },
            },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
          required: ['people'],
        },
        HandleListPage: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  handle: { type: 'string' },
                  name: { type: ['string', 'null'] },
                  avatar_url: { type: ['string', 'null'], format: 'uri' },
                },
                required: ['handle'],
              },
            },
            total: { type: 'integer' },
          },
          required: ['items'],
        },
        SearchResults: {
          type: 'object',
          description: 'Ranked matches grouped by object type. Absent groups mean no matches.',
          properties: {
            skills: { type: 'array', items: { $ref: '#/components/schemas/SkillSummary' } },
            kits: { type: 'array', items: { $ref: '#/components/schemas/KitSummary' } },
            people: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  handle: { type: 'string' },
                  name: { type: ['string', 'null'] },
                  avatar_url: { type: ['string', 'null'], format: 'uri' },
                },
                required: ['handle'],
              },
            },
          },
        },
        ActivityPage: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    description: 'Event type, e.g. `skill_published`, `kit_published`.',
                  },
                  actor: { type: 'string', description: 'Handle that caused the event.' },
                  skill_id: { type: ['string', 'null'] },
                  kit_id: { type: ['string', 'null'] },
                  created_at: { type: 'integer', description: 'Unix seconds.' },
                },
                required: ['kind', 'created_at'],
              },
            },
          },
          required: ['events'],
        },
        RegistryStats: {
          type: 'object',
          properties: {
            skills: { type: 'integer' },
            authors: { type: 'integer' },
            kits: { type: 'integer' },
            devices: { type: 'integer' },
          },
        },
        ModerationLog: {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string', description: 'Skill id or handle acted on.' },
                  action: { type: 'string', description: 'What was applied, e.g. `unlisted`.' },
                  reason: { type: ['string', 'null'] },
                  created_at: { type: 'integer' },
                },
                required: ['target', 'action'],
              },
            },
          },
          required: ['actions'],
        },
        WhoAmI: {
          type: 'object',
          properties: {
            authenticated: { type: 'boolean' },
            handle: { type: ['string', 'null'] },
            user_id: { type: ['string', 'null'] },
            token_class: {
              type: ['string', 'null'],
              enum: ['session', 'device', 'kit', 'mcp', null],
            },
            scopes: {
              type: 'array',
              items: { type: 'string', enum: Object.keys(OPENAPI_SCOPES) },
              description: 'The scopes this token grants.',
            },
          },
          required: ['authenticated'],
        },
        SyncManifest: {
          type: 'object',
          properties: {
            skills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  skill_id: { type: 'string' },
                  hash: { type: 'string', description: 'Approved content hash to materialize.' },
                  version_label: { type: 'string' },
                  source: {
                    type: 'string',
                    description: 'Why this skill is in the manifest (own, kit, subscription).',
                  },
                },
                required: ['skill_id', 'hash'],
              },
            },
          },
          required: ['skills'],
        },
        JsonRpcRequest: {
          type: 'object',
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            id: { type: ['string', 'integer', 'null'] },
            method: { type: 'string', examples: ['tools/list', 'tools/call'] },
            params: { type: 'object', additionalProperties: true },
          },
          required: ['jsonrpc', 'method'],
        },
        JsonRpcResponse: {
          type: 'object',
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            id: { type: ['string', 'integer', 'null'] },
            result: { type: 'object', additionalProperties: true },
            error: {
              type: 'object',
              properties: {
                code: { type: 'integer' },
                message: { type: 'string' },
                data: { type: 'object', additionalProperties: true },
              },
              required: ['code', 'message'],
            },
          },
          required: ['jsonrpc'],
        },
      },
    },
  };
}

/** HTTP methods an OpenAPI path item can carry an operation under. */
const OPERATION_KEYS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/**
 * Build the OpenAPI document for a deployment.
 *
 * `siteUrl` is listed first in `servers` because the apex mirror is the URL an
 * agent finds from `/llms.txt` and `/openapi.json`; the registry origin is
 * listed second for callers that need the write surface (the apex mirror is
 * read-only by design).
 *
 * Every operation leaves here with an explicit `security` list that NAMES its
 * scopes. The document-level `security: [{}]` already said "anonymous works",
 * but an agent holding a token learned nothing from it about how little it
 * could get away with presenting — `[{}, { bearerAuth: ['read'] }]` says both:
 * no credential is needed, and `read` is enough if you have one. Operations
 * that declare their own grant (`sync`, `publish`) are left alone.
 */
export function buildOpenApiDocument(opts: OpenApiOptions): OpenApiDocument {
  const doc = baseOpenApiDocument(opts);
  for (const pathItem of Object.values(doc.paths)) {
    for (const key of OPERATION_KEYS) {
      const op = pathItem[key] as Record<string, unknown> | undefined;
      if (!op || typeof op !== 'object') continue;
      if (op['security'] !== undefined) continue;
      op['security'] = [{}, { bearerAuth: ['read'] }];
    }
  }
  return doc;
}
