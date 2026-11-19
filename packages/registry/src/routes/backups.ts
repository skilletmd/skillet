// Private backups of the person's own skills, keyed by content hash
// (kit map onboarding, KTD7, KTD14).
//
//   PUT    /api/v1/backups/:hash    store one bundle (idempotent), device or session auth
//   GET    /api/v1/backups          the caller's backups and quota use
//   GET    /api/v1/backups/:hash    one backup with its bundle
//   DELETE /api/v1/backups/:hash    remove one
//   POST   /api/v1/backups/sources  which of a merge's source hashes match a public skill
//
// A backup is never a `skills` row and never enters the sync manifest: a plain
// private upload would make every later sync write `owner--slug` copies into
// every tool, and publishing over an existing slug would turn the local copy
// into a new private version of the published skill. A hash is no secret
// (anyone can compute a public skill's), so the owner always comes from the
// caller's credentials and every read and delete is scoped to it. A bundle with
// a high-confidence secret is refused before anything is written, with the
// publish route's `scan_blocked` body: file and line, never the secret's bytes.

import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  BundleError,
  MAX_BUNDLE_BYTES,
  canonicalContentHash,
  decodeBundle,
  encodeBundle,
  stripSkilletBackupPaths,
  validateBundle,
  type BundleFiles,
  type DecodedBundle,
} from '@skillet/protocol'
import {
  KIT_MAP_DESCRIPTION_MAX,
  KIT_MAP_HASH_RE,
  KIT_MAP_NAME_MAX,
  KIT_MAP_TOOL_RE,
  isKitMapDisplayName,
  parseKitMapMergeSource,
  type KitMapMergeSource,
} from '@skillet/protocol/kit-map'
import { requireUser } from '../auth/middleware.js'
import { blobHash, newId } from '../db/index.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { loadBundleFromManifest, putFileBlobs } from '../blob-store/index.js'
import type { BlobStore } from '../blob-store/types.js'
import { secretsBlockingScan } from '../scanner/index.js'

const BARE_HASH_RE = /^[0-9a-f]{64}$/
const MAX_TOOLS = 64
const MAX_SOURCES = 64
const MAX_LOOKUP_KEYS = 200
/** `skill_backup_files.path` is VARCHAR(191), like `skill_version_files.path`. */
const MAX_PATH_CHARS = 191
/** 25 MB of bytes, base64'd, plus the JSON around it. */
const PUT_BODY_LIMIT = 36 * 1024 * 1024

const DEFAULT_MAX_COUNT = 2_000
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024

type Origin = 'scan' | 'drop' | 'merge'
const ORIGINS: readonly Origin[] = ['scan', 'drop', 'merge']

interface BackupMeta {
  name: string
  description: string
  tools: string[]
  origin: Origin
  /** A merge's sources: a public skill by its ref, or a private one counted by hash (the kit map's own shape). */
  sources: KitMapMergeSource[] | null
}

interface BackupLimits {
  maxCount: number
  maxBytes: number
  maxBundleBytes: number
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Read per request, so an operator (or a test) can tighten them without a restart. */
export function loadBackupLimits(): BackupLimits {
  return {
    maxCount: positiveEnv('SKILLET_BACKUP_MAX_COUNT', DEFAULT_MAX_COUNT),
    maxBytes: positiveEnv('SKILLET_BACKUP_MAX_BYTES', DEFAULT_MAX_BYTES),
    maxBundleBytes: positiveEnv('SKILLET_BACKUP_MAX_BUNDLE_BYTES', MAX_BUNDLE_BYTES),
  }
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  return prisma
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.entries(value).every(([key, field]) => field === undefined || allowed.includes(key))
}

/** `sha256:<hex>` from either the prefixed or the bare form, or null. */
function normalizeHash(raw: string): string | null {
  if (KIT_MAP_HASH_RE.test(raw)) return raw
  return BARE_HASH_RE.test(raw) ? `sha256:${raw}` : null
}

/** The body around the bundle, or a reason it can't be stored. */
function readBackupMeta(body: Record<string, unknown>): BackupMeta | string {
  if (!onlyFields(body, ['files', 'name', 'description', 'tools', 'origin', 'sources'])) {
    return 'unknown field: a backup carries files, name, description, tools, origin and sources only'
  }
  if (!isKitMapDisplayName(body.name)) return `name is required, one line, at most ${KIT_MAP_NAME_MAX} characters`
  const description = body.description ?? ''
  if (typeof description !== 'string' || description.length > KIT_MAP_DESCRIPTION_MAX) {
    return `description is at most ${KIT_MAP_DESCRIPTION_MAX} characters`
  }
  const tools = body.tools ?? []
  if (
    !Array.isArray(tools) ||
    tools.length > MAX_TOOLS ||
    !tools.every((tool) => typeof tool === 'string' && KIT_MAP_TOOL_RE.test(tool)) ||
    new Set(tools).size !== tools.length
  ) {
    return 'tools is a list of distinct tool ids'
  }
  if (!ORIGINS.includes(body.origin as Origin)) return 'origin is scan, drop or merge'
  const origin = body.origin as Origin
  let sources: KitMapMergeSource[] | null = null
  if (body.sources !== undefined) {
    if (origin !== 'merge') return 'only a merge has sources'
    if (!Array.isArray(body.sources) || body.sources.length > MAX_SOURCES) return 'sources is a list'
    const read = body.sources.map((source) => parseKitMapMergeSource(source))
    if (read.some((source) => source === null)) return 'each source is { key, ref, name } or { key, private: true }'
    sources = read as KitMapMergeSource[]
    if (new Set(sources.map((source) => source.key)).size !== sources.length) return 'a source appears once'
  }
  return { name: body.name, description, tools: tools as string[], origin, sources }
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

interface BackupRow {
  hash: string
  name: string
  description: string
  tools: string
  size: number
  origin: string
  sources: string | null
  created_at: number
}

const BACKUP_SELECT = {
  hash: true,
  name: true,
  description: true,
  tools: true,
  size: true,
  origin: true,
  sources: true,
  created_at: true,
} as const

function toWire(row: BackupRow): Record<string, unknown> {
  return {
    hash: row.hash,
    name: row.name,
    description: row.description,
    tools: parseJsonArray(row.tools),
    size: row.size,
    origin: row.origin,
    ...(row.sources != null ? { sources: parseJsonArray(row.sources) } : {}),
    created_at: row.created_at,
  }
}

function bundleBytes(bundle: DecodedBundle): number {
  let total = 0
  for (const bytes of bundle.values()) total += bytes.byteLength
  return total
}

function webOrigin(): string {
  return (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '')
}

const notFound = { error: 'backup_not_found', message: 'No backup with this hash on your account.' }

export function registerBackupRoutes(
  app: FastifyInstance,
  blobStore: BlobStore,
  prismaArg?: PrismaClient,
): void {
  const prisma =
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined)

  app.put<{ Params: { hash: string }; Body: unknown }>(
    '/api/v1/backups/:hash',
    { preHandler: requireUser(), bodyLimit: PUT_BODY_LIMIT },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = (req.principal as { user_id: string }).user_id
      const hash = normalizeHash(req.params.hash)
      if (!hash) {
        return reply.code(400).send({ error: 'invalid_hash', message: 'The hash is sha256:<64 hex>.' })
      }
      const body = req.body
      if (!isRecord(body) || !isRecord(body.files)) {
        return reply.code(422).send({ error: 'invalid_backup', message: 'files is required' })
      }
      const meta = readBackupMeta(body)
      if (typeof meta === 'string') {
        return reply.code(422).send({ error: 'invalid_backup', message: meta })
      }

      let bundle: DecodedBundle
      try {
        bundle = stripSkilletBackupPaths(decodeBundle(body.files as BundleFiles))
      } catch (err) {
        if (err instanceof BundleError) return reply.code(422).send({ error: err.code, message: err.message })
        throw err
      }
      const limits = loadBackupLimits()
      const size = bundleBytes(bundle)
      if (size > limits.maxBundleBytes) {
        return reply.code(413).send({
          error: 'backup_too_large',
          message: `This skill is ${size} bytes; a backup holds at most ${limits.maxBundleBytes}.`,
          max_bytes: limits.maxBundleBytes,
        })
      }
      try {
        validateBundle(bundle)
      } catch (err) {
        if (err instanceof BundleError) return reply.code(422).send({ error: err.code, message: err.message })
        throw err
      }
      if ([...bundle.keys()].some((path) => path.length > MAX_PATH_CHARS)) {
        return reply.code(422).send({
          error: 'path_too_long',
          message: `A file path in a backup is at most ${MAX_PATH_CHARS} characters.`,
        })
      }
      if (canonicalContentHash(bundle) !== hash) {
        return reply.code(422).send({
          error: 'hash_mismatch',
          message: "The bundle's content hash doesn't match the one in the URL.",
        })
      }

      // Before any write: no row, no blob for a bundle carrying a credential.
      const secretHit = secretsBlockingScan(bundle)
      if (secretHit) {
        return reply.code(422).send({
          error: 'scan_blocked',
          reason: 'secret' as const,
          status: 'quarantined' as const,
          message:
            'Backup blocked: a credential was detected. Remove the secret (use an env var or placeholder) and save again.',
          findings: [
            {
              category: secretHit.category,
              confidence: secretHit.confidence,
              file: secretHit.file,
              lineStart: secretHit.lineStart,
              lineEnd: secretHit.lineEnd,
              why: secretHit.why,
            },
          ],
        })
      }

      const stored = { hash, size, created: false }
      const existing = await db.skill_backups.findUnique({
        where: { user_id_hash: { user_id: userId, hash } },
        select: { id: true },
      })
      if (existing) return reply.code(200).send(stored)

      const usage = await db.skill_backups.aggregate({
        where: { user_id: userId },
        _count: { _all: true },
        _sum: { size: true },
      })
      const count = usage._count._all
      const bytes = usage._sum.size ?? 0
      if (count + 1 > limits.maxCount || bytes + size > limits.maxBytes) {
        return reply.code(413).send({
          error: 'backup_quota_exceeded',
          message: 'Your account holds as many backups as it can. Delete some to back up more.',
          count,
          bytes,
          max_count: limits.maxCount,
          max_bytes: limits.maxBytes,
        })
      }

      const files = [...bundle].map(([path, fileBytes]) => ({ path, hash: blobHash(fileBytes), bytes: fileBytes }))
      await putFileBlobs(blobStore, files)
      const id = newId()
      try {
        await runPrismaTransaction(db, async (tx) => {
          await tx.skill_backups.create({
            data: {
              id,
              user_id: userId,
              hash,
              name: meta.name,
              description: meta.description,
              tools: JSON.stringify(meta.tools),
              size,
              origin: meta.origin,
              sources: meta.sources ? JSON.stringify(meta.sources) : null,
              created_at: Math.floor(Date.now() / 1000),
            },
          })
          await tx.skill_backup_files.createMany({
            data: files.map((file) => ({ backup_id: id, path: file.path, blob_hash: file.hash })),
          })
        })
      } catch (err) {
        // The same backup from a second request at once: it's stored either way.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(200).send(stored)
        }
        throw err
      }
      return reply.code(201).send({ ...stored, created: true })
    },
  )

  app.get('/api/v1/backups', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = (req.principal as { user_id: string }).user_id
    const rows = await db.skill_backups.findMany({
      where: { user_id: userId },
      orderBy: [{ created_at: 'desc' }, { hash: 'asc' }],
      select: BACKUP_SELECT,
    })
    const limits = loadBackupLimits()
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({
      backups: rows.map(toWire),
      usage: {
        count: rows.length,
        bytes: rows.reduce((sum, row) => sum + row.size, 0),
        max_count: limits.maxCount,
        max_bytes: limits.maxBytes,
      },
    })
  })

  app.get<{ Params: { hash: string } }>(
    '/api/v1/backups/:hash',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = (req.principal as { user_id: string }).user_id
      const hash = normalizeHash(req.params.hash)
      if (!hash) return reply.code(404).send(notFound)
      const row = await db.skill_backups.findUnique({
        where: { user_id_hash: { user_id: userId, hash } },
        select: { ...BACKUP_SELECT, id: true },
      })
      if (!row) return reply.code(404).send(notFound)
      const manifest = await db.skill_backup_files.findMany({
        where: { backup_id: row.id },
        orderBy: { path: 'asc' },
        select: { path: true, blob_hash: true },
      })
      const bundle = await loadBundleFromManifest(blobStore, manifest)
      if (!bundle || canonicalContentHash(bundle) !== hash) {
        req.log.error({ hash }, 'backup bundle bytes missing or corrupt')
        return reply.code(503).send({ error: 'backup_unavailable', message: "This backup's files can't be read right now." })
      }
      reply.header('Cache-Control', 'private, no-store')
      return reply.send({ ...toWire(row), files: encodeBundle(bundle) })
    },
  )

  app.delete<{ Params: { hash: string } }>(
    '/api/v1/backups/:hash',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = (req.principal as { user_id: string }).user_id
      const hash = normalizeHash(req.params.hash)
      if (!hash) return reply.code(404).send(notFound)
      // The files rows go with it (ON DELETE CASCADE). The blobs stay: they are
      // content-addressed and may back a published version too.
      const removed = await db.skill_backups.deleteMany({ where: { user_id: userId, hash } })
      if (removed.count === 0) return reply.code(404).send(notFound)
      return reply.code(204).send()
    },
  )

  // KTD14: a merge credits its sources. A local source that matches a public
  // skill version names its maker, name and page; anything else is private,
  // which the merged skill only counts.
  app.post<{ Body: { keys?: unknown } }>(
    '/api/v1/backups/sources',
    { preHandler: requireUser(), bodyLimit: 64 * 1024 },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const keys = req.body?.keys
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.length > MAX_LOOKUP_KEYS ||
        !keys.every((key) => typeof key === 'string' && KIT_MAP_HASH_RE.test(key)) ||
        new Set(keys).size !== keys.length
      ) {
        return reply.code(422).send({
          error: 'invalid_keys',
          message: `keys is a list of 1 to ${MAX_LOOKUP_KEYS} distinct sha256:<hex> content hashes`,
        })
      }
      const versions = await db.skill_versions.findMany({
        where: {
          hash: { in: keys as string[] },
          yanked_at: null,
          skills: { visibility: 'public', moderation_status: { in: ['none', 'unlisted'] } },
        },
        orderBy: [{ published_at: 'asc' }, { skill_id: 'asc' }],
        select: { hash: true, skills: { select: { author_id: true, slug: true } } },
      })
      // The first to publish these bytes is their maker.
      const byHash = new Map<string, { author_id: string; slug: string }>()
      for (const version of versions) {
        if (!byHash.has(version.hash)) byHash.set(version.hash, version.skills)
      }
      const web = webOrigin()
      return reply.send({
        sources: (keys as string[]).map((key) => {
          const skill = byHash.get(key)
          if (!skill) return { key, private: true }
          return {
            key,
            ref: `@${skill.author_id}/${skill.slug}`,
            maker: skill.author_id,
            name: skill.slug,
            page: `${web}/${skill.author_id}/${skill.slug}`,
          }
        }),
      })
    },
  )
}
