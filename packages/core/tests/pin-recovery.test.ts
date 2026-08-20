import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAuthorKeyMismatch,
  compareAuthorPin,
  acceptAuthorKeyRotation,
  formatAuthorKeyMismatchHint,
  truncateKeyId,
} from '../src/signing/pin-recovery.js';
import { pinAuthorKey, loadPinnedKey } from '../src/signing/pin.js';
import { generateAuthorKey } from '../src/signing/index.js';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skillet-pin-recovery-'));
}

function publicKeyBytesB64(key: ReturnType<typeof generateAuthorKey>): string {
  const jwk = key.publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

describe('parseAuthorKeyMismatch', () => {
  it('parses author_key_changed pull reasons', () => {
    const oldId = 'b'.repeat(64);
    const newId = 'c'.repeat(64);
    const reason = `key_id_mismatch: author_key_changed: handle thiago pinned to ${oldId}, registry served ${newId}`;
    const parsed = parseAuthorKeyMismatch(reason);
    expect(parsed).toEqual({
      handle: 'thiago',
      pinnedKeyId: oldId,
      servedKeyId: newId,
    });
  });

  it('returns null for unrelated failures', () => {
    expect(parseAuthorKeyMismatch('integrity_failed: bad sig')).toBeNull();
  });
});

describe('compareAuthorPin / acceptAuthorKeyRotation', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports mismatch when pinned and served keys differ', async () => {
    const oldKey = generateAuthorKey();
    const newKey = generateAuthorKey();
    await pinAuthorKey(
      'thiago',
      { key_id: oldKey.keyId, pub: publicKeyBytesB64(oldKey), first_seen_version: 1 },
      dir,
    );
    const comparison = await compareAuthorPin('thiago', dir, {
      key_id: newKey.keyId,
      pub: publicKeyBytesB64(newKey),
    });
    expect(comparison.mismatch).toBe(true);
    expect(comparison.pinned?.key_id).toBe(oldKey.keyId);
  });

  it('acceptAuthorKeyRotation replaces the pin', async () => {
    const oldKey = generateAuthorKey();
    const newKey = generateAuthorKey();
    await pinAuthorKey(
      'thiago',
      { key_id: oldKey.keyId, pub: publicKeyBytesB64(oldKey), first_seen_version: 1 },
      dir,
    );
    await acceptAuthorKeyRotation(
      'thiago',
      { key_id: newKey.keyId, pub: publicKeyBytesB64(newKey) },
      dir,
    );
    const loaded = await loadPinnedKey('thiago', dir);
    expect(loaded?.key_id).toBe(newKey.keyId);
  });
});

describe('formatAuthorKeyMismatchHint', () => {
  it('includes recovery command', () => {
    const lines = formatAuthorKeyMismatchHint({
      handle: 'thiago',
      pinnedKeyId: 'a'.repeat(64),
      servedKeyId: 'b'.repeat(64),
    });
    expect(lines.join('\n')).toContain('skillet pin accept thiago');
    expect(lines.join('\n')).toContain(truncateKeyId('a'.repeat(64)));
  });
});
