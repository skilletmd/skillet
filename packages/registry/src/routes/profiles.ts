import type { FastifyInstance } from 'fastify';
import { serializeSummonSuggestionSet } from '@skillet/protocol';
import { validateEditedSuggestions } from '../suggestions/payload.js';
import {
  emitSuggestionCopyEvent,
  isRecordableCopy,
} from '../lib/suggestion-copy-events.js';
import type { PrismaClient } from '@prisma/client';
import { requireSession } from '../auth/middleware.js';
import type { AvatarStore } from '../avatars/avatar-store.js';
import { canAdminOrgAuthorPrisma } from '../lib/org-access.js';
import { getAuthorPagePrisma } from '../lib/author-page.js';
import { parseAgentList } from './device-agents.js';
import { getProfilePrisma } from '../lib/profile-payload.js';
import { getHandleKitCandidatesPrisma } from '../lib/handle-kit.js';

interface CreateProfileBody {
  id: string;
  name: string;
  avatar_url?: string;
  bio?: string;
  profile_url?: string;
}

interface UpdateProfileBody {
  name?: string;
  avatar_url?: string;
  bio?: string | null;
  profile_url?: string | null;
  /** Self-typed X (Twitter) handle, bare or as a url/@handle; '' clears it. */
  x_handle?: string | null;
  /** Show/hide the detected-runtimes ("Runs") row on the public profile (legacy). */
  agents_public?: boolean;
  /** Curated list of agent keys to show on the profile. `null` resets to uncurated
   *  (legacy fallback); `[]` shows nothing; an array curates exactly those keys. */
  shown_agents?: string[] | null;
  /** The author's own three `/skillet @handle <task>` lines. `[]` clears them.
   *  Any write here is terminal: regeneration never touches an edited set. */
  suggestions?: Array<{ task: string; ref: string }>;
}

/**
 * Normalize a self-typed X handle to a bare handle (no '@', no url), or null.
 * Accepts "@name", "name", "x.com/name", "twitter.com/name", with optional
 * scheme/query. Returns null when empty or not a valid X handle (1-15 chars of
 * [A-Za-z0-9_]) so a junk value never renders as a broken link.
 */
function normalizeXHandle(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let h = raw.trim();
  if (!h) return null;
  h = h.replace(/^https?:\/\//i, '').replace(/^(www\.)?(x|twitter)\.com\//i, '');
  h = h.replace(/[?#].*$/, '').replace(/^@/, '').replace(/\/+$/, '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
}

interface ProfileParams {
  author: string;
}

const AUTHOR_ID_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/;

/** A hosted avatar reference (URL or site-relative path) is short; anything near
 *  this is either a stuffed data: blob or junk. */
const MAX_AVATAR_URL_LEN = 1024;
/** profile_url is a single external link; well past any real homepage URL. */
const MAX_PROFILE_URL_LEN = 1024;

/**
 * Shared URL-scheme validator. Returns an error string, or null when OK.
 * Empty/null is always allowed (the field is cleared).
 *
 * `mode` parameterizes the per-field contract — they are NOT the same:
 *  - 'avatar': a hosted image reference. http(s) URL *or* a site-relative path
 *    (the preset characters) is fine; only an inline `data:` image is rejected
 *    (it bloats the row and, because the session seed copies avatar_url into the
 *    JWT, pushes the session cookie past the 16KB header limit → HTTP 431).
 *  - 'http': an absolute http(s) link only. Any other scheme — `javascript:`,
 *    `data:`, etc. — is rejected. Used for profile_url, which is rendered into an
 *    href, so a non-http scheme is a stored-XSS vector.
 */
function urlSchemeError(
  value: string | null,
  opts: { field: string; maxLen: number; mode: 'avatar' | 'http' },
): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length > opts.maxLen) return `${opts.field} is too long`;
  if (opts.mode === 'avatar') {
    // Case-insensitive: `Data:` / `DATA:` are still a valid data URI to the browser.
    if (v.toLowerCase().startsWith('data:')) {
      return `${opts.field} must be a hosted image URL, not inline image data`;
    }
    return null;
  }
  // mode === 'http': must parse as an absolute http(s) URL (mirrors auth.ts).
  let protocol: string | null = null;
  try {
    protocol = new URL(v).protocol;
  } catch {
    protocol = null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return `${opts.field} must be an http(s) URL`;
  }
  return null;
}

/** avatar_url contract — see urlSchemeError('avatar'). */
function avatarUrlError(value: string | null): string | null {
  return urlSchemeError(value, { field: 'avatar_url', maxLen: MAX_AVATAR_URL_LEN, mode: 'avatar' });
}

/** profile_url contract — http(s) only, see urlSchemeError('http'). */
function profileUrlError(value: string | null): string | null {
  return urlSchemeError(value, {
    field: 'profile_url',
    maxLen: MAX_PROFILE_URL_LEN,
    mode: 'http',
  });
}

/** Normalize an inbound profile_url to a trimmed string or null. */
function normalizeProfileUrl(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/** Normalize an inbound avatar_url to a trimmed string or null. */
function normalizeAvatarUrl(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/** RIFF container with a 'WEBP' fourCC — the magic bytes the registry verifies
 *  before trusting an avatar upload, rather than the caller-supplied content type. */
function isWebp(bytes: Buffer): boolean {
  return (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  );
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

export function registerProfileRoutes(
  app: FastifyInstance,
  opts: { getAvatarStore?: () => AvatarStore; prisma?: PrismaClient } = {},
): void {
  const prisma =
    opts.prisma ??
    (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined);

  // POST /profiles — register an author (session owner must match id).
  app.post<{ Body: CreateProfileBody }>(
    '/profiles',
    { preHandler: requireSession },
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const { id, name, avatar_url, bio, profile_url } = req.body ?? {};

      if (!id || !name) {
        return reply.status(400).send({ error: 'id and name are required' });
      }

      if (!AUTHOR_ID_RE.test(id)) {
        return reply
          .status(400)
          .send({ error: 'id must be 1-40 lowercase alphanumeric characters or hyphens' });
      }

      const principal = req.principal as {
        class: 'session';
        handle: string | null;
        user_id: string;
      };
      if (!principal.handle || principal.handle !== id) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const createAvatar = normalizeAvatarUrl(avatar_url);
      const createAvatarErr = avatarUrlError(createAvatar);
      if (createAvatarErr) return reply.status(400).send({ error: createAvatarErr });

      const createProfileUrl = normalizeProfileUrl(profile_url);
      const createProfileUrlErr = profileUrlError(createProfileUrl);
      if (createProfileUrlErr) return reply.status(400).send({ error: createProfileUrlErr });

      const existing = await db.authors.findUnique({
        where: { id },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({ error: `Author '${id}' already exists` });
      }
      await db.authors.create({
        data: {
          id,
          name,
          avatar_url: createAvatar,
          bio: bio ?? null,
          profile_url: createProfileUrl,
        },
      });
      return reply.status(201).send(await getProfilePrisma(db, id));
    },
  );

  // GET /profiles/:author — author profile with published skills and install counts
  app.get<{ Params: ProfileParams }>('/profiles/:author', async (req, reply) => {
    const db = requirePrisma(prisma);
    const p = req.principal;
    let callerHandle: string | null = null;
    if (p?.class === 'session') {
      callerHandle = p.handle;
    } else if (p?.class === 'device' && p.user_id) {
      const row = await db.users.findUnique({
        where: { id: p.user_id },
        select: { handle: true },
      });
      callerHandle = row?.handle ?? null;
    }
    const profile = await getProfilePrisma(db, req.params.author, callerHandle);
    if (!profile) {
      return reply.status(404).send({ error: 'Author not found' });
    }
    return reply.send(profile);
  });

  // GET /authors/:username — public author page for the web directory.
  // Authenticated author sees their own private skills; anonymous and
  // other-user callers see only public skills.
  app.get<{ Params: { username: string } }>('/authors/:username', async (req, reply) => {
    const db = requirePrisma(prisma);
    const p = req.principal;
    let caller:
      | { handle: string | null; userId: string | null }
      | undefined;
    if (p?.class === 'session') {
      caller = { handle: p.handle, userId: p.user_id };
    } else if (p?.class === 'device' && p.user_id) {
      const row = await db.users.findUnique({
        where: { id: p.user_id },
        select: { handle: true },
      });
      caller = { handle: row?.handle ?? null, userId: p.user_id };
    }
    const page = await getAuthorPagePrisma(db, req.params.username, caller);
    if (!page) {
      return reply.status(404).send({ error: 'Author not found' });
    }
    return reply.send(page);
  });

  // GET /authors/:handle/summon — a handle's PUBLIC kit as routing candidates
  // for `/skillet @handle` (#011). Distinct from /authors/:author/kit (the
  // subscribe-to-author virtual kit, authored-only): this is the SUMMON set =
  // authored-public UNION skills the handle curated into a public kit (curated
  // candidates carry `via` + the true author ref). Anonymous, public-only:
  // never exposes a private skill or a private (default) Saved kit.
  app.get<{ Params: { handle: string } }>('/authors/:handle/summon', async (req, reply) => {
    const db = requirePrisma(prisma);
    const handle = req.params.handle.replace(/^@/, '');
    const author = await db.authors.findUnique({ where: { id: handle }, select: { id: true } });
    if (!author) {
      return reply.status(404).send({ error: 'Author not found' });
    }
    const skills = await getHandleKitCandidatesPrisma(db, handle);
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send({ handle, skills });
  });

  // POST /authors/:handle/suggestions/copy — count a copied suggestion line.
  //
  // Deliberately anonymous and unauthenticated: the visitor this measures is
  // the logged-out stranger who followed a shared profile link, which is
  // exactly the population /api/v1/events cannot see (it is requireUser()).
  // Aggregate-only, no per-visitor row — see lib/suggestion-copy-events.ts.
  app.post<{ Params: { handle: string }; Body: { ref?: string } }>(
    '/authors/:handle/suggestions/copy',
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const handle = req.params.handle.replace(/^@/, '');
      const ref = (req.body?.ref ?? '').replace(/^@/, '').replace('/', ':');

      // Always 204. A copy already happened on the client; reporting its
      // outcome back would only invite a retry loop over a number nobody is
      // waiting on, and a rejected report is not the visitor's problem.
      if (isRecordableCopy(handle, ref)) {
        void emitSuggestionCopyEvent({ prisma: db, authorId: handle, skillId: ref }).catch(
          () => {},
        );
      }
      return reply.status(204).send();
    },
  );

  // PATCH /profiles/:author — update name or avatar (owner only)
  // 401 for unauthenticated callers, 403 for authenticated non-owners.
  app.patch<{ Params: ProfileParams; Body: UpdateProfileBody }>(
    '/profiles/:author',
    { preHandler: requireSession },
    async (req, reply) => {
      const db = requirePrisma(prisma);
      const { author } = req.params;

      const principal = req.principal as {
        class: 'session';
        handle: string | null;
        user_id: string;
      };

      const { name, avatar_url, bio, profile_url, x_handle, agents_public, shown_agents, suggestions } =
        req.body ?? {};

      const existing = await db.authors.findUnique({
        where: { id: author },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Author not found' });
      }
      const canEdit =
        principal.handle === author ||
        (await canAdminOrgAuthorPrisma(db, author, principal.user_id));
      if (!canEdit) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const data: {
        name?: string;
        avatar_url?: string | null;
        bio?: string | null;
        profile_url?: string | null;
        x_handle?: string | null;
        agents_public?: number;
        shown_agents?: string | null;
        suggestions?: string;
        suggestions_edited_at?: number;
      } = {};
      if (name !== undefined) data.name = name;
      if (avatar_url !== undefined) {
        const nextAvatar = normalizeAvatarUrl(avatar_url);
        const avatarErr = avatarUrlError(nextAvatar);
        if (avatarErr) return reply.status(400).send({ error: avatarErr });
        data.avatar_url = nextAvatar;
      }
      if (bio !== undefined) data.bio = bio || null;
      if (profile_url !== undefined) {
        const nextProfileUrl = normalizeProfileUrl(profile_url);
        const profileUrlErr = profileUrlError(nextProfileUrl);
        if (profileUrlErr) return reply.status(400).send({ error: profileUrlErr });
        data.profile_url = nextProfileUrl;
      }
      if (x_handle !== undefined) data.x_handle = normalizeXHandle(x_handle);
      if (agents_public !== undefined) data.agents_public = agents_public ? 1 : 0;
      if (shown_agents !== undefined) {
        if (shown_agents === null) {
          data.shown_agents = null;
        } else {
          const parsed = parseAgentList(shown_agents);
          if (parsed === null) {
            return reply.status(400).send({ error: 'invalid shown_agents' });
          }
          data.shown_agents = JSON.stringify(parsed);
        }
      }
      if (suggestions !== undefined) {
        // A ref must be this author's own public skill. Otherwise an author
        // could publish a line pointing at a private skill, or at someone
        // else's work, and it would resolve to nothing or to the wrong person.
        const owned = await db.skills.findMany({
          where: { author_id: author, visibility: 'public', moderation_status: { not: 'unlisted' } },
          select: { slug: true },
        });
        const ownedRefs = new Set(owned.map((r) => `@${author}/${r.slug}`));
        const checked = validateEditedSuggestions(suggestions, ownedRefs);
        if (!checked.ok) return reply.status(400).send({ error: checked.error });

        // The signature is deliberately blank: an edited set is terminal, so
        // nothing ever compares it against a current kit again.
        data.suggestions = serializeSummonSuggestionSet({
          suggestions: checked.suggestions,
          kit_signature: '',
        });
        data.suggestions_edited_at = Math.floor(Date.now() / 1000);
      }
      if (Object.keys(data).length > 0) {
        await db.authors.update({ where: { id: author }, data });
      }
      return reply.send(await getProfilePrisma(db, author));
    },
  );

  // POST /profiles/:author/avatar — store an avatar image in the public R2
  // bucket and point authors.avatar_url at it (owner only). The web BFF has
  // already re-encoded the upload to a small webp (see web: lib/process-avatar);
  // the registry never sees raw camera bytes and never stores image bytes in the
  // DB. The body is the raw webp (parsed to a Buffer by the image/webp
  // content-type parser); bodyLimit keeps a stray large upload off this route.
  if (opts.getAvatarStore) {
    const getAvatarStore = opts.getAvatarStore;
    app.post<{ Params: ProfileParams }>(
      '/profiles/:author/avatar',
      { preHandler: requireSession, bodyLimit: 256 * 1024 },
      async (req, reply) => {
        const db = requirePrisma(prisma);
        const { author } = req.params;

        const principal = req.principal as {
          class: 'session';
          handle: string | null;
          user_id: string;
        };
        const existing = await db.authors.findUnique({
          where: { id: author },
          select: { id: true },
        });
        if (!existing) {
          return reply.status(404).send({ error: 'Author not found' });
        }
        const canEdit =
          principal.handle === author ||
          (await canAdminOrgAuthorPrisma(db, author, principal.user_id));
        if (!canEdit) {
          return reply.status(403).send({ error: 'forbidden' });
        }

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return reply.status(400).send({ error: 'expected an image/webp body' });
        }
        if (!isWebp(body)) {
          return reply.status(415).send({ error: 'avatar must be image/webp' });
        }

        const store = getAvatarStore();
        const { hash } = await store.putAvatar(new Uint8Array(body), 'image/webp');
        const avatarUrl = store.avatarUrl(hash);
        await db.authors.update({
          where: { id: author },
          data: { avatar_url: avatarUrl },
        });

        return reply.send({ avatar_url: avatarUrl });
      },
    );
  }
}
