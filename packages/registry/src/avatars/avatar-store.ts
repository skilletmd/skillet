// Avatar object storage. Avatars are public images — stored in a dedicated
// public R2 bucket (`skillet-avatars`), separate from the private content-
// addressed `registry-blobs` store, and served directly by Cloudflare from the
// public bucket URL. We never store image bytes in SQLite (DB/backup bloat) and
// never serve them through the registry. R2 is required in every environment;
// dev and prod share the bucket, separated by `R2_AVATARS_KEY_PREFIX`.
import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

export interface AvatarStoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL the browser fetches avatars from (r2.dev or custom domain). */
  publicBaseUrl: string;
  /** Namespace prefix, e.g. `dev/` locally so test avatars don't touch prod's. */
  keyPrefix?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name} for avatar storage`);
  }
  return value;
}

/** Read avatar-store config from the environment. Throws loudly if unset — there
 *  is no sqlite fallback, by design. */
export function avatarStoreConfigFromEnv(): AvatarStoreConfig {
  return {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_AVATARS_BUCKET'),
    publicBaseUrl: requireEnv('R2_AVATARS_PUBLIC_BASE_URL'),
    keyPrefix: process.env.R2_AVATARS_KEY_PREFIX?.trim() || undefined,
  };
}

/** Normalize a prefix to either '' or 'something/'. */
function normalizePrefix(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/` : '';
}

export class AvatarStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly keyPrefix: string;

  constructor(config: AvatarStoreConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, '');
    this.keyPrefix = normalizePrefix(config.keyPrefix);
    const s3Config: S3ClientConfig = {
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = client ?? new S3Client(s3Config);
  }

  /** sha256 hex of the processed bytes — content-addressed so identical images
   *  dedupe and the public object is safe to cache forever. */
  hashBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private key(hash: string): string {
    const bare = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
    return `${this.keyPrefix}${bare}`;
  }

  /** Store processed avatar bytes in the public bucket. Idempotent for identical
   *  bytes (same key). Returns the content hash. */
  async putAvatar(
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ hash: string }> {
    const hash = this.hashBytes(bytes);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(hash),
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return { hash };
  }

  /** Public URL the browser loads — content-addressed and immutable. */
  avatarUrl(hash: string): string {
    return `${this.publicBaseUrl}/${this.key(hash)}`;
  }
}
