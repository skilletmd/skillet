import type { DatabaseSync } from '../db/sqlite-handle.js'
import { newId } from '../db/index.js'
import { handleOrSlugTakenPrisma } from '../lib/org-access.js'
import type { PrismaDb } from '../db/prisma-client.js'

export type IdentityProvider = 'github' | 'google' | 'email' | 'twitter'

export interface WebIdentityInput {
  provider: IdentityProvider
  provider_subject_id: string
  email?: string | null
  /** The IdP confirmed the user controls `email`. Drives the publish/claim gate. */
  email_verified?: boolean
  login?: string | null
  two_factor?: boolean
  display_name?: string | null
  avatar_url?: string | null
}

export interface MintedUserSession {
  user_id: string
  handle: string | null
  email: string | null
  two_factor: boolean
  linked_providers: IdentityProvider[]
}

export interface UserSocialLinks {
  github: string | null
  twitter: string | null
}

/**
 * Fail-closed stand-in for residual dual-path profile callers outside U2.
 * Characterization uses tests/legacy-sqlite-auth-helpers.
 */
export function userSocialLinks(_db: DatabaseSync, _userId: string): UserSocialLinks {
  throw new Error('sqlite registry store removed; use Prisma social links')
}

/**
 * Fail-closed stand-in for residual dual-path invite/brand callers outside U2.
 * Characterization uses tests/legacy-sqlite-auth-helpers.
 */
export function userHasVerifiedEmailMatch(
  _db: DatabaseSync,
  _userId: string,
  email: string | null | undefined,
): boolean {
  if (!email) return false
  throw new Error('sqlite registry store removed; use userHasVerifiedEmailMatchPrisma')
}

/**
 * Fail-closed stand-in for residual dual-path proposal callers outside U2.
 */
export function userHasVerifiedEmail(_db: DatabaseSync, _userId: string): boolean {
  throw new Error('sqlite registry store removed; use userHasVerifiedEmailPrisma')
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/

/** Providers whose IdP-verified email proves control of that specific address. */
const AUTO_LINK_PROVIDERS = new Set<IdentityProvider>(['google', 'email'])

function identityEmailVerified(input: WebIdentityInput): boolean {
  if (input.provider === 'github') return true;
  if (input.provider === 'email') return true;
  if (input.provider === 'google' || input.provider === 'twitter') {
    return input.email_verified === true;
  }
  return false;
}

export async function userHasVerifiedEmailMatchPrisma(
  prisma: PrismaDb,
  userId: string,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const row = await prisma.user_identities.findFirst({
    where: {
      user_id: userId,
      email_verified: 1,
      // MySQL utf8mb4_unicode_ci already compares emails case-insensitively.
      email,
    },
    select: { user_id: true },
  });
  return row != null;
}

export async function userHasGithubIdentityPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<boolean> {
  const identity = await prisma.user_identities.findFirst({
    where: { user_id: userId, provider: 'github' },
    select: { user_id: true },
  });
  if (identity) return true;
  const legacy = await prisma.users.findUnique({
    where: { id: userId },
    select: { github_id: true },
  });
  return legacy?.github_id != null;
}

export async function identityProfileHintsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<{ display_name: string | null; avatar_url: string | null }> {
  const rows = await prisma.user_identities.findMany({
    where: {
      user_id: userId,
      OR: [{ display_name: { not: null } }, { avatar_url: { not: null } }],
    },
    orderBy: { created_at: 'desc' },
    select: { display_name: true, avatar_url: true },
  });
  const hints: { display_name: string | null; avatar_url: string | null } = {
    display_name: null,
    avatar_url: null,
  };
  for (const row of rows) {
    hints.display_name ??= row.display_name;
    hints.avatar_url ??= row.avatar_url;
  }
  return hints;
}

const PROVIDER_EMAIL_PRIORITY: Record<string, number> = {
  email: 0,
  google: 1,
  github: 2,
  twitter: 3,
};

/** Prisma async counterpart of {@link userHasVerifiedEmail} (U4 wave 1). */
export async function userHasVerifiedEmailPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<boolean> {
  const row = await prisma.user_identities.findFirst({
    where: { user_id: userId, email_verified: 1 },
    select: { user_id: true },
  });
  return row != null;
}

/** Prisma async counterpart of {@link userLinkedProviders} (U4 wave 1). */
export async function userLinkedProvidersPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<IdentityProvider[]> {
  const rows = await prisma.user_identities.findMany({
    where: { user_id: userId },
    select: { provider: true },
    orderBy: { provider: 'asc' },
  });
  return rows.map((r) => r.provider as IdentityProvider);
}

/** Prisma async counterpart of {@link userPrimaryEmail} (U4 wave 1). */
export async function userPrimaryEmailPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string | null> {
  const rows = await prisma.user_identities.findMany({
    where: {
      user_id: userId,
      email: { not: null },
      NOT: { email: '' },
    },
    select: {
      email: true,
      email_verified: true,
      provider: true,
      created_at: true,
    },
  });
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    if (b.email_verified !== a.email_verified) return b.email_verified - a.email_verified;
    const pa = PROVIDER_EMAIL_PRIORITY[a.provider] ?? 4;
    const pb = PROVIDER_EMAIL_PRIORITY[b.provider] ?? 4;
    if (pa !== pb) return pa - pb;
    return b.created_at - a.created_at;
  });
  return rows[0]?.email ?? null;
}

/** Prisma async counterpart of {@link userIdByVerifiedEmail} (U4 wave 1). */
export async function userIdByVerifiedEmailPrisma(
  prisma: PrismaDb,
  email: string | null | undefined,
): Promise<string | null> {
  if (!email) return null;
  // MySQL collation may already be case-insensitive; LOWER keeps parity with sqlite.
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT user_id FROM user_identities
     WHERE email IS NOT NULL
       AND email_verified = 1
       AND LOWER(email) = LOWER(${email})
     LIMIT 2`;
  return rows.length === 1 ? rows[0].user_id : null;
}

async function prefillHandlePrisma(
  prisma: PrismaDb,
  input: WebIdentityInput,
): Promise<string | null> {
  if (input.provider !== 'github' || !input.login) return null;
  const normalized = input.login.toLowerCase();
  if (!HANDLE_RE.test(normalized)) return null;
  return (await handleOrSlugTakenPrisma(prisma, normalized)) ? null : normalized;
}

/** Prisma async counterpart of {@link applyIdpProfileToAuthor} (U4 wave 1). */
export async function applyIdpProfileToAuthorPrisma(
  prisma: PrismaDb,
  handle: string | null,
  hints: { display_name?: string | null; avatar_url?: string | null },
): Promise<void> {
  if (!handle) return;

  const displayName = hints.display_name?.trim() || null;
  const avatarUrl = hints.avatar_url?.trim() || null;
  if (!displayName && !avatarUrl) return;

  const existing = await prisma.authors.findUnique({
    where: { id: handle },
    select: { id: true, name: true, avatar_url: true },
  });

  if (!existing) {
    await prisma.authors.createMany({
      data: [{ id: handle, name: displayName ?? handle, avatar_url: avatarUrl }],
      skipDuplicates: true,
    });
    return;
  }

  const namePlaceholder = !existing.name || existing.name === handle;
  const nextName = displayName && namePlaceholder ? displayName : existing.name;
  const nextAvatar = existing.avatar_url ?? avatarUrl;

  if (nextName !== existing.name || nextAvatar !== existing.avatar_url) {
    await prisma.authors.update({
      where: { id: handle },
      data: { name: nextName, avatar_url: nextAvatar },
    });
  }
}

/**
 * Upsert a provider identity and return the owning user row (Prisma / MySQL).
 * When linking to an existing session user, pass linkToUserId.
 */
export async function upsertIdentityUserPrisma(
  prisma: PrismaDb,
  input: WebIdentityInput,
  linkToUserId?: string,
): Promise<MintedUserSession> {
  const existingIdentity = await prisma.user_identities.findUnique({
    where: {
      provider_provider_subject_id: {
        provider: input.provider,
        provider_subject_id: input.provider_subject_id,
      },
    },
    select: { user_id: true },
  });

  let userId = existingIdentity?.user_id ?? linkToUserId;

  if (!userId && AUTO_LINK_PROVIDERS.has(input.provider) && identityEmailVerified(input)) {
    userId = (await userIdByVerifiedEmailPrisma(prisma, input.email)) ?? undefined;
  }

  if (!userId) {
    userId = newId();
    const handle = await prefillHandlePrisma(prisma, input);
    const githubId = input.provider === 'github' ? input.provider_subject_id : null;
    const twoFactorInt = input.provider === 'github' && input.two_factor ? 1 : 0;

    await prisma.users.create({
      data: {
        id: userId,
        handle,
        github_id: githubId,
        two_factor: twoFactorInt,
      },
    });
  } else if (input.provider === 'github') {
    await prisma.users.update({
      where: { id: userId },
      data: {
        github_id: input.provider_subject_id,
        two_factor: input.two_factor ? 1 : 0,
      },
    });
  }

  // Same poisoning guard as the sqlite path: never plant a verified email owned
  // by another user onto this identity.
  const incomingVerified = identityEmailVerified(input);
  const ownerOfIncoming =
    input.email && incomingVerified
      ? await userIdByVerifiedEmailPrisma(prisma, input.email)
      : null;
  const emailContested = ownerOfIncoming != null && ownerOfIncoming !== userId;

  const emailToWrite = emailContested ? null : (input.email ?? null);
  const emailVerifiedInt = emailContested ? 0 : incomingVerified ? 1 : 0;
  const providerLogin = input.login?.trim() || null;
  const displayName = input.display_name?.trim() || null;
  const avatarUrl = input.avatar_url?.trim() || null;

  const identityKey = {
    provider: input.provider,
    provider_subject_id: input.provider_subject_id,
  };
  const existingRow = await prisma.user_identities.findUnique({
    where: { provider_provider_subject_id: identityKey },
  });

  if (!existingRow) {
    await prisma.user_identities.create({
      data: {
        user_id: userId,
        provider: input.provider,
        provider_subject_id: input.provider_subject_id,
        email: emailToWrite,
        email_verified: emailVerifiedInt,
        provider_login: providerLogin,
        display_name: displayName,
        avatar_url: avatarUrl,
      },
    });
  } else {
    // Mirror sqlite ON CONFLICT COALESCE / MAX semantics.
    await prisma.user_identities.update({
      where: { provider_provider_subject_id: identityKey },
      data: {
        email: emailToWrite ?? existingRow.email,
        email_verified: Math.max(existingRow.email_verified, emailVerifiedInt),
        provider_login: providerLogin ?? existingRow.provider_login,
        display_name: displayName ?? existingRow.display_name,
        avatar_url: avatarUrl ?? existingRow.avatar_url,
      },
    });
  }

  const userRow = await prisma.users.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, handle: true, two_factor: true },
  });

  await applyIdpProfileToAuthorPrisma(prisma, userRow.handle, {
    display_name: input.display_name,
    avatar_url: input.avatar_url,
  });

  return {
    user_id: userRow.id,
    handle: userRow.handle,
    email: await userPrimaryEmailPrisma(prisma, userRow.id),
    two_factor: userRow.two_factor === 1,
    linked_providers: await userLinkedProvidersPrisma(prisma, userRow.id),
  };
}
