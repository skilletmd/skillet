// Follow graph mutations and reads for the MySQL/Prisma path (U4).
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import type { FollowEdge, FollowKind, FollowerEntry } from '../db/index.js'
import { suspendedAuthorHandlesPrisma } from './suspension.js'

export async function subjectExistsPrisma(
  prisma: PrismaDb,
  kind: FollowKind,
  id: string,
): Promise<boolean> {
  if (kind === 'author') {
    const row = await prisma.authors.findUnique({
      where: { id },
      select: { id: true },
    })
    return row != null
  }
  if (kind === 'org') {
    const row = await prisma.organizations.findUnique({
      where: { slug: id },
      select: { slug: true },
    })
    return row != null
  }
  return false
}

/** Follow a subject. Idempotent. Returns true if a new edge was created. */
export async function followSubjectPrisma(
  prisma: PrismaClient,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): Promise<boolean> {
  return runPrismaTransaction(prisma, async (tx) => {
    try {
      await tx.follows.create({
        data: {
          follower_user_id: userId,
          subject_kind: kind,
          subject_id: subjectId,
        },
      })
    } catch (err: unknown) {
      // Unique constraint → already following (idempotent).
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return false
      }
      throw err
    }
    await tx.follow_counts.upsert({
      where: {
        subject_kind_subject_id: {
          subject_kind: kind,
          subject_id: subjectId,
        },
      },
      create: {
        subject_kind: kind,
        subject_id: subjectId,
        followers: 1,
        subscribers: 0,
      },
      update: { followers: { increment: 1 } },
    })
    return true
  })
}

/** Unfollow a subject. Idempotent. Returns true if an edge was removed. */
export async function unfollowSubjectPrisma(
  prisma: PrismaClient,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): Promise<boolean> {
  return runPrismaTransaction(prisma, async (tx) => {
    const res = await tx.follows.deleteMany({
      where: {
        follower_user_id: userId,
        subject_kind: kind,
        subject_id: subjectId,
      },
    })
    if (res.count === 0) return false
    const count = await tx.follow_counts.findUnique({
      where: {
        subject_kind_subject_id: {
          subject_kind: kind,
          subject_id: subjectId,
        },
      },
      select: { followers: true },
    })
    if (count) {
      await tx.follow_counts.update({
        where: {
          subject_kind_subject_id: {
            subject_kind: kind,
            subject_id: subjectId,
          },
        },
        data: { followers: Math.max(0, count.followers - 1) },
      })
    }
    return true
  })
}

export async function isFollowingPrisma(
  prisma: PrismaDb,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): Promise<boolean> {
  const row = await prisma.follows.findUnique({
    where: {
      follower_user_id_subject_kind_subject_id: {
        follower_user_id: userId,
        subject_kind: kind,
        subject_id: subjectId,
      },
    },
    select: { follower_user_id: true },
  })
  return row != null
}

export async function getFollowerCountPrisma(
  prisma: PrismaDb,
  kind: FollowKind,
  subjectId: string,
): Promise<number> {
  const row = await prisma.follow_counts.findUnique({
    where: {
      subject_kind_subject_id: {
        subject_kind: kind,
        subject_id: subjectId,
      },
    },
    select: { followers: true },
  })
  return row?.followers ?? 0
}

export async function getFollowingCountPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<number> {
  return prisma.follows.count({
    where: { follower_user_id: userId, subject_kind: 'author' },
  })
}

export async function listFollowingPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<FollowEdge[]> {
  const rows = await prisma.follows.findMany({
    where: { follower_user_id: userId },
    orderBy: { created_at: 'desc' },
    select: {
      subject_kind: true,
      subject_id: true,
      created_at: true,
    },
  })
  return rows.map((r) => ({
    subject_kind: r.subject_kind as FollowKind,
    subject_id: r.subject_id,
    created_at: r.created_at,
  }))
}

export async function listFollowersPrisma(
  prisma: PrismaDb,
  kind: FollowKind,
  subjectId: string,
): Promise<FollowerEntry[]> {
  const rows = await prisma.follows.findMany({
    where: {
      subject_kind: kind,
      subject_id: subjectId,
      is_private: 0,
      users: { suspended_at: null },
    },
    orderBy: { created_at: 'desc' },
    select: {
      created_at: true,
      users: { select: { handle: true } },
    },
  })
  return rows.map((r) => ({
    handle: r.users.handle,
    created_at: r.created_at,
  }))
}

export async function listFollowingHandlesPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string[]> {
  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))
  const rows = await prisma.follows.findMany({
    where: {
      follower_user_id: userId,
      subject_kind: 'author',
      is_private: 0,
    },
    orderBy: { created_at: 'desc' },
    select: { subject_id: true },
  })
  return rows.map((r) => r.subject_id).filter((id) => !suspended.has(id))
}

export async function getUserIdByHandlePrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<string | null> {
  const row = await prisma.users.findUnique({
    where: { handle },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function enrichHandlePrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<{
  handle: string
  name: string
  avatar_url: string | null
  bio: string | null
}> {
  const a = await prisma.authors.findUnique({
    where: { id: handle },
    select: { name: true, avatar_url: true, bio: true },
  })
  return {
    handle,
    name: a?.name ?? handle,
    avatar_url: a?.avatar_url ?? null,
    bio: a?.bio ?? null,
  }
}
