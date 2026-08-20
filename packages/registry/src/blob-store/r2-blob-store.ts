import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'
import type { BlobStore, R2BlobStoreConfig } from './types.js'
import { blobObjectKey } from './object-key.js'
import { verifyBlobBytes } from './verify-bytes.js'
import { hasBlobMetaPrisma, putBlobMetaPrisma } from './blob-meta.js'

/**
 * Cloudflare R2 via the S3-compatible API. Metadata rows (`storage_loc = 'r2'`)
 * live in the relational store; bytes never touch MySQL/SQLite BLOB columns.
 *
 * Sqlite dual-path meta legs were removed in U5 — Prisma is required for meta.
 */
export class R2BlobStore implements BlobStore {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly keyPrefix: string

  constructor(
    private readonly _db: DatabaseSync,
    config: R2BlobStoreConfig,
    client?: S3Client,
    private readonly prisma?: PrismaDb,
  ) {
    this.bucket = config.bucket
    this.keyPrefix = config.keyPrefix ?? ''
    const s3Config: S3ClientConfig = {
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }
    this.client = client ?? new S3Client(s3Config)
  }

  private key(hash: string): string {
    return blobObjectKey(hash, this.keyPrefix)
  }

  async get(hash: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }),
      )
      if (!res.Body) return null
      const bytes = new Uint8Array(await res.Body.transformToByteArray())
      if (!verifyBlobBytes(hash, bytes)) return null
      return bytes
    } catch (err: unknown) {
      const name = (err as { name?: string }).name
      if (name === 'NoSuchKey' || name === 'NotFound') return null
      throw err
    }
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(hash),
        Body: bytes,
        ContentLength: bytes.byteLength,
        // Request SSE-S3 explicitly. R2 encrypts at rest by default and accepts
        // this header (idempotent), so the at-rest control is code-visible
        // rather than resting on an undocumented bucket default. App-layer
        // envelope encryption of private bundles is a separate, deferred
        // decision (issue #462) because it breaks cross-user blob dedup.
        ServerSideEncryption: 'AES256',
      }),
    )
    if (!this.prisma) {
      throw new Error('sqlite registry store removed; R2BlobStore requires Prisma for blob meta')
    }
    await putBlobMetaPrisma(this.prisma, hash, bytes.byteLength, 'r2')
  }

  async has(hash: string): Promise<boolean> {
    if (this.prisma && (await hasBlobMetaPrisma(this.prisma, hash))) return true
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }),
      )
      return true
    } catch {
      return false
    }
  }
}
