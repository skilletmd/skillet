// Shared mirror-author upsert — used by the admin mirror-queue approve path and
// the nightly mirror job. One rule lives here: a mirror author row is writable
// from source metadata only while UNCLAIMED. Once mirror_claimed_at is set the
// real owner controls the profile, so every profile write is guarded in SQL
// (updateMany WHERE mirror_claimed_at IS NULL), never read-then-write — a claim
// landing mid-run must not be clobbered.
import { Prisma } from '@prisma/client';
import type { PrismaDb } from '../db/prisma-client.js';

/** Raised when a mirror upsert would clobber a real (non-mirror) author. */
export class RealAuthorCollisionError extends Error {
}

/** Optional seed-file profile fields (mirror-sources.json). The queue path
 *  omits these and gets the historical defaults (name = owner login). */
export interface MirrorAuthorProfile {
    displayName?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    /** Overrides the github.com/<ownerLogin> default (seeds use the repo URL). */
    profileUrl?: string;
    sourceUrl?: string;
}

/** Mirror author row for a candidate or seed (is_mirror=1, claimable).
 *  Creates the row when missing; refreshes profile fields only while the
 *  handle is unclaimed. Never touches mirror_claimed_at. */
export async function upsertMirrorAuthorPrisma(prisma: PrismaDb, handle: string, ownerLogin: string, repoFull: string, ownerType: string | null, profile?: MirrorAuthorProfile): Promise<void> {
    const existing = await prisma.authors.findUnique({
        where: { id: handle },
        select: { is_mirror: true },
    });
    if (existing && existing.is_mirror !== 1) {
        throw new RealAuthorCollisionError(handle);
    }
    const sourceUrl = profile?.sourceUrl ?? `https://github.com/${repoFull}`;
    const profileUrl = profile?.profileUrl ?? `https://github.com/${ownerLogin}`;
    const name = profile?.displayName ?? ownerLogin;
    const updateData = {
        profile_url: profileUrl,
        is_mirror: 1,
        mirror_source_url: sourceUrl,
        source_owner_type: ownerType,
        // Profile fields refresh only when the caller supplies them (the seed
        // path); the queue path leaves an existing name/bio/avatar alone.
        ...(profile?.displayName != null ? { name } : {}),
        ...(profile?.bio !== undefined ? { bio: profile.bio } : {}),
        ...(profile?.avatarUrl !== undefined ? { avatar_url: profile.avatarUrl } : {}),
    };
    const createData = {
        id: handle,
        name,
        profile_url: profileUrl,
        is_mirror: 1,
        mirror_source_url: sourceUrl,
        source_owner_type: ownerType,
        ...(profile?.bio !== undefined ? { bio: profile.bio } : {}),
        ...(profile?.avatarUrl !== undefined ? { avatar_url: profile.avatarUrl } : {}),
    };
    // Three count-0 cases are disambiguated by the guard read above and the
    // create fallback: claimed row (no-op by design), missing row (create),
    // real-author collision (already thrown).
    const updated = await prisma.authors.updateMany({
        where: { id: handle, is_mirror: 1, mirror_claimed_at: null },
        data: updateData,
    });
    if (updated.count > 0 || existing) {
        return; // refreshed, or exists but claimed — profile is the owner's now
    }
    try {
        await prisma.authors.create({ data: createData });
    }
    catch (err) {
        // Lost a create race. If the winner is a real author, that's still a
        // collision; otherwise re-run the guarded update once (a claimed
        // winner makes it a no-op, which is correct).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const winner = await prisma.authors.findUnique({
                where: { id: handle },
                select: { is_mirror: true },
            });
            if (winner && winner.is_mirror !== 1) {
                throw new RealAuthorCollisionError(handle);
            }
            await prisma.authors.updateMany({
                where: { id: handle, is_mirror: 1, mirror_claimed_at: null },
                data: updateData,
            });
            return;
        }
        throw err;
    }
}
