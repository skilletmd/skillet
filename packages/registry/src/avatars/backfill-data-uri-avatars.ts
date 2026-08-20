// One-shot backfill: re-host legacy inline `data:` avatars into the public R2
// avatar bucket and repoint authors.avatar_url at the resulting URL.
//
// This is NOT a numbered schema migration: those run synchronously inside the DB
// open path, and an R2 PutObject is async network I/O that requires R2 creds the
// migration runner has no business depending on. It's an out-of-band maintenance
// script (see backfill-avatars-cli.ts), idempotent — a second run finds no
// `data:` rows because the first converted them to URLs.
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { AvatarStore } from './avatar-store.js';

export interface AvatarBackfillResult {
  /** Rows converted to an R2 URL (0 when dryRun). */
  converted: number;
  /** Rows skipped because the value wasn't a parseable base64 image data URI. */
  skipped: number;
  /** Rows whose upload threw. */
  failed: number;
  /** In a dry run, how many rows would be converted. */
  candidates: number;
}

interface AuthorAvatarRow {
  id: string;
  avatar_url: string;
}

// data:<image-mime>;base64,<payload>
const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is;

export interface BackfillOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

/**
 * Convert every `data:` avatar in `authors` to an R2-hosted URL. The original
 * bytes are stored as-is under their declared image type (content-addressed, so
 * re-running dedupes); avatar_url is then repointed at the public URL.
 */
export async function backfillDataUriAvatars(
  db: DatabaseSync,
  store: AvatarStore,
  options: BackfillOptions = {},
): Promise<AvatarBackfillResult> {
  const log = options.log ?? (() => {});
  const rows = db
    .prepare("SELECT id, avatar_url FROM authors WHERE avatar_url LIKE 'data:image/%'")
    .all() as unknown as AuthorAvatarRow[];

  const result: AvatarBackfillResult = {
    converted: 0,
    skipped: 0,
    failed: 0,
    candidates: 0,
  };

  for (const row of rows) {
    const match = DATA_URI_RE.exec(row.avatar_url);
    if (!match) {
      result.skipped += 1;
      log(`skip ${row.id}: avatar_url is not a base64 image data URI`);
      continue;
    }
    result.candidates += 1;
    if (options.dryRun) {
      log(`[dry-run] would convert ${row.id} (${match[1]})`);
      continue;
    }

    try {
      const contentType = match[1];
      const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
      const { hash } = await store.putAvatar(bytes, contentType);
      const url = store.avatarUrl(hash);
      db.prepare('UPDATE authors SET avatar_url = ? WHERE id = ?').run(url, row.id);
      result.converted += 1;
      log(`convert ${row.id} -> ${url}`);
    } catch (err) {
      result.failed += 1;
      log(`FAILED ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
