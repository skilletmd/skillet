// Publish-path leaf helpers for the MySQL/Prisma path (U4 remainder).
// Mirrors prepare()/transaction patterns from routes/skills.ts publish section.
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { bumpAttentionForHandlePrisma } from './attention.js'
import { lastCleanHashPrisma } from './sync-manifest.js'
import { recordPublishAndMaybeAlertPrisma } from '../ratelimit/publish.js'
import { CAPABILITY_VERSION } from '../scanner/capabilities/scan.js'
import { DETECTOR_CORPUS_VERSION } from '../scanner/cache.js'
import type { VersionLabel } from '../semver-classify.js'
import { deriveVersionLabelPrisma } from '../version-label.js'

export interface PublishSkillRow {
  id: string
  latest_hash: string | null
  install_count: number
  visibility: string
  moderation_status: string
}

export interface InsertSkillOnPublishInput {
  skillId: string
  authorId: string
  slug: string
  description: string | null
  visibility: 'private' | 'public'
  createdByUserId: string
  orgId: string | null
  sourceRepo: string | null
  sourceUrl: string | null
}

export interface InsertSkillVersionInput {
  versionHash: string
  skillId: string
  signatureAlg: string
  signatureKeyId: string
  signatureB64: string
  authorKeyId: string | null
  sigVersion: number
  delegationJson: string | null
  label: VersionLabel
  metadataJson: string
  publishedBy: string
  tokenCount: number
  tokenAmbient: number
  tokenBundle: number | null
  tokenMethod: string
}

/** Load the skill row used by the publish concurrency/idempotency guards. */
export async function getSkillForPublishPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<PublishSkillRow | null> {
  return prisma.skills.findUnique({
    where: { id: skillId },
    select: {
      id: true,
      latest_hash: true,
      install_count: true,
      visibility: true,
      moderation_status: true,
    },
  })
}

/** True when this skill already has a version at `versionHash`. */
export async function skillVersionExistsPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
): Promise<boolean> {
  const row = await prisma.skill_versions.findUnique({
    where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
    select: { hash: true },
  })
  return row != null
}

/** Idempotent publish path: flip visibility when bytes are unchanged. */
export async function updateSkillVisibilityPrisma(
  prisma: PrismaDb,
  skillId: string,
  visibility: 'private' | 'public',
): Promise<void> {
  await prisma.skills.update({
    where: { id: skillId },
    data: { visibility },
  })
}

/**
 * First publish: insert the skills row. Caller must ensure author (and org if
 * orgId set) rows exist for FK safety.
 */
export async function insertSkillOnPublishPrisma(
  prisma: PrismaDb,
  input: InsertSkillOnPublishInput,
): Promise<void> {
  await prisma.skills.create({
    data: {
      id: input.skillId,
      author_id: input.authorId,
      slug: input.slug,
      description: input.description,
      visibility: input.visibility,
      created_by_user_id: input.createdByUserId,
      org_id: input.orgId,
      source_repo: input.sourceRepo,
      source_url: input.sourceUrl,
    },
  })
}

/** Republish of an existing skill: visibility-only update inside the write txn. */
export async function republishUpdateSkillVisibilityPrisma(
  prisma: PrismaDb,
  skillId: string,
  visibility: 'private' | 'public',
): Promise<void> {
  await updateSkillVisibilityPrisma(prisma, skillId, visibility)
}

/** Bump latest_hash and optionally refresh description after a version insert. */
export async function updateSkillLatestOnPublishPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
  description: string | null,
): Promise<void> {
  await prisma.skills.update({
    where: { id: skillId },
    data: {
      latest_hash: versionHash,
      ...(description != null ? { description } : {}),
    },
  })
}

/** Insert one skill_versions row (publish txn leaf). */
export async function insertSkillVersionOnPublishPrisma(
  prisma: PrismaDb,
  input: InsertSkillVersionInput,
): Promise<void> {
  await prisma.skill_versions.create({
    data: {
      hash: input.versionHash,
      skill_id: input.skillId,
      signature_alg: input.signatureAlg,
      signature_key_id: input.signatureKeyId,
      signature_b64: input.signatureB64,
      author_key_id: input.authorKeyId,
      sig_version: input.sigVersion,
      delegation_json: input.delegationJson,
      major: input.label.major,
      minor: input.label.minor,
      patch: input.label.patch,
      metadata_json: input.metadataJson,
      published_by: input.publishedBy,
      token_count: input.tokenCount,
      token_ambient: input.tokenAmbient,
      token_bundle: input.tokenBundle,
      token_method: input.tokenMethod,
    },
  })
}

/** Wire version files; uses createMany skipDuplicates instead of INSERT OR IGNORE. */
export async function insertSkillVersionFilesPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
  files: Array<{ path: string; blobHash: string }>,
): Promise<void> {
  if (files.length === 0) return
  await prisma.skill_version_files.createMany({
    data: files.map((file) => ({
      skill_id: skillId,
      version_hash: versionHash,
      path: file.path,
      blob_hash: file.blobHash,
    })),
    skipDuplicates: true,
  })
}

export interface CommitPublishNewVersionInput {
  existing: PublishSkillRow | null
  skillId: string
  authorId: string
  slug: string
  description: string | null
  visibility: 'private' | 'public'
  createdByUserId: string
  orgId: string | null
  sourceRepo: string | null
  sourceUrl: string | null
  versionHash: string
  signatureAlg: string
  signatureKeyId: string
  signatureB64: string
  authorKeyId: string | null
  sigVersion: number
  delegationJson: string | null
  bumpKind: import('../semver-classify.js').BumpKind
  metadataJson: string
  publishedBy: string
  fileBlobs: Array<{ path: string; blobHash: string }>
  publisherUserId: string
  tokenCount: number
  tokenAmbient: number
  tokenBundle: number | null
  tokenMethod: string
}

/** Full publish write txn: skill + version + files + log + pending scan + baseline. */
export async function commitPublishNewVersionPrisma(
  prisma: PrismaClient,
  input: CommitPublishNewVersionInput,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return runPrismaTransaction(prisma, async (tx) => {
    if (!input.existing) {
      await insertSkillOnPublishPrisma(tx, {
        skillId: input.skillId,
        authorId: input.authorId,
        slug: input.slug,
        description: input.description,
        visibility: input.visibility,
        createdByUserId: input.createdByUserId,
        orgId: input.orgId,
        sourceRepo: input.sourceRepo,
        sourceUrl: input.sourceUrl,
      })
    } else {
      await republishUpdateSkillVisibilityPrisma(tx, input.skillId, input.visibility)
    }

    const { label, versionLabel } = await deriveVersionLabelPrisma(tx, input.skillId, input.bumpKind)

    await insertSkillVersionOnPublishPrisma(tx, {
      versionHash: input.versionHash,
      skillId: input.skillId,
      signatureAlg: input.signatureAlg,
      signatureKeyId: input.signatureKeyId,
      signatureB64: input.signatureB64,
      authorKeyId: input.authorKeyId,
      sigVersion: input.sigVersion,
      delegationJson: input.delegationJson,
      label,
      metadataJson: input.metadataJson,
      publishedBy: input.publishedBy,
      tokenCount: input.tokenCount,
      tokenAmbient: input.tokenAmbient,
      tokenBundle: input.tokenBundle,
      tokenMethod: input.tokenMethod,
    })
    await insertSkillVersionFilesPrisma(
      tx,
      input.skillId,
      input.versionHash,
      input.fileBlobs,
    )
    await updateSkillLatestOnPublishPrisma(
      tx,
      input.skillId,
      input.versionHash,
      input.description,
    )

    // PROTOCOL §7.4 — same publish_log + burst-alert path as sqlite, inside
    // the write txn so a rolled-back publish never leaves a phantom log/alert.
    await recordPublishAndMaybeAlertPrisma(tx, {
      userId: input.publisherUserId,
      skillId: input.skillId,
      contentHash: input.versionHash,
      publishedAt: now,
    })

    await tx.skill_version_scans.createMany({
      data: [
        {
          skill_id: input.skillId,
          skill_version_id: input.versionHash,
          status: 'pending',
          findings_json: '[]',
          scanned_at: null,
        },
      ],
      skipDuplicates: true,
    })

    await tx.update_decisions.createMany({
      data: [
        {
          id: randomUUID(),
          user_id: input.publisherUserId,
          skill_id: input.skillId,
          version_hash: input.versionHash,
          state: 'approved',
          source: 'auto',
        },
      ],
      skipDuplicates: true,
    })

    return versionLabel
  })
}

/**
 * Retroactive enforcement when a scan resolves the live pointer to
 * `quarantined`. Mirrors scanner/runner `rebalanceAfterScan`.
 */
export async function rebalanceAfterScanPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
  status: string,
): Promise<void> {
  if (status !== 'quarantined') return
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { latest_hash: true, author_id: true },
  })
  if (!skill || skill.latest_hash !== versionHash) return
  const clean = await lastCleanHashPrisma(prisma, skillId)
  await prisma.skills.update({
    where: { id: skillId },
    data: { latest_hash: clean },
  })
  await recordQuarantineNoticePrisma(prisma, skillId, skill.author_id, versionHash)
}

/** Best-effort author notice after a quarantine rebalance. */
async function recordQuarantineNoticePrisma(
  prisma: PrismaDb,
  skillId: string,
  authorId: string,
  versionHash: string,
): Promise<void> {
  try {
    const created = await prisma.version_scan_notices.createMany({
      data: [
        {
          version_hash: versionHash,
          skill_id: skillId,
          author_id: authorId,
          reason: 'quarantined',
        },
      ],
      skipDuplicates: true,
    })
    if (created.count > 0) {
      await bumpAttentionForHandlePrisma(prisma, authorId)
    }
  } catch {
    // Notice delivery never blocks enforcement.
  }
}

/**
 * Persist a version scan on MySQL. Matches sqlite `persistVersionScan`:
 * null capabilities leave existing capability columns untouched; non-null
 * stamps capabilities_json + CAPABILITY_VERSION together; then rebalance.
 */
export async function persistVersionScanPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
  status: string,
  findingsJson: string,
  capabilitiesJson: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  if (capabilitiesJson == null) {
    await prisma.skill_version_scans.upsert({
      where: {
        skill_id_skill_version_id: {
          skill_id: skillId,
          skill_version_id: versionHash,
        },
      },
      create: {
        skill_id: skillId,
        skill_version_id: versionHash,
        status,
        findings_json: findingsJson,
        scanned_at: now,
        detector_corpus_version: DETECTOR_CORPUS_VERSION,
      },
      update: {
        status,
        findings_json: findingsJson,
        scanned_at: now,
        detector_corpus_version: DETECTOR_CORPUS_VERSION,
      },
    })
  } else {
    await prisma.skill_version_scans.upsert({
      where: {
        skill_id_skill_version_id: {
          skill_id: skillId,
          skill_version_id: versionHash,
        },
      },
      create: {
        skill_id: skillId,
        skill_version_id: versionHash,
        status,
        findings_json: findingsJson,
        scanned_at: now,
        detector_corpus_version: DETECTOR_CORPUS_VERSION,
        capabilities_json: capabilitiesJson,
        capabilities_version: CAPABILITY_VERSION,
      },
      update: {
        status,
        findings_json: findingsJson,
        scanned_at: now,
        detector_corpus_version: DETECTOR_CORPUS_VERSION,
        capabilities_json: capabilitiesJson,
        capabilities_version: CAPABILITY_VERSION,
      },
    })
  }
  await rebalanceAfterScanPrisma(prisma, skillId, versionHash, status)
}
