// U1 — public R2 avatar store: content-addressed put + public URL resolution.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  AvatarStore,
  avatarStoreConfigFromEnv,
  type AvatarStoreConfig,
} from '../src/avatars/avatar-store.js';

const CONFIG: AvatarStoreConfig = {
  accountId: 'acct',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucket: 'skillet-avatars',
  publicBaseUrl: 'https://pub-test.r2.dev',
  keyPrefix: 'dev/',
};

interface RecordedPut {
  Bucket?: string;
  Key?: string;
  Body?: Uint8Array;
  ContentType?: string;
}

function fakeClient(): { client: S3Client; puts: RecordedPut[] } {
  const puts: RecordedPut[] = [];
  const client = {
    send: async (cmd: { input: RecordedPut }) => {
      puts.push(cmd.input);
      return {};
    },
  } as unknown as S3Client;
  return { client, puts };
}

describe('avatar store', () => {
  it('avatarUrl returns publicBase/prefix/hash', () => {
    const { client } = fakeClient();
    const store = new AvatarStore(CONFIG, client);
    const hash = 'a'.repeat(64);
    assert.equal(
      store.avatarUrl(hash),
      `https://pub-test.r2.dev/dev/${hash}`,
    );
  });

  it('avatarUrl strips a leading sha256: and a trailing slash on the base', () => {
    const { client } = fakeClient();
    const store = new AvatarStore(
      { ...CONFIG, publicBaseUrl: 'https://pub-test.r2.dev/' },
      client,
    );
    const hash = 'b'.repeat(64);
    assert.equal(
      store.avatarUrl(`sha256:${hash}`),
      `https://pub-test.r2.dev/dev/${hash}`,
    );
  });

  it('putAvatar issues a PutObject with the prefixed key + content type, returns the content hash', async () => {
    const { client, puts } = fakeClient();
    const store = new AvatarStore(CONFIG, client);
    const bytes = new TextEncoder().encode('fake-webp-bytes');
    const expected = createHash('sha256').update(bytes).digest('hex');

    const { hash } = await store.putAvatar(bytes, 'image/webp');

    assert.equal(hash, expected);
    assert.equal(puts.length, 1);
    assert.equal(puts[0]?.Bucket, 'skillet-avatars');
    assert.equal(puts[0]?.Key, `dev/${expected}`);
    assert.equal(puts[0]?.ContentType, 'image/webp');
  });

  it('identical bytes produce the same key (content-addressed dedupe)', async () => {
    const { client, puts } = fakeClient();
    const store = new AvatarStore(CONFIG, client);
    const bytes = new TextEncoder().encode('same');
    await store.putAvatar(bytes, 'image/webp');
    await store.putAvatar(bytes, 'image/webp');
    assert.equal(puts[0]?.Key, puts[1]?.Key);
  });

  it('empty prefix yields a bare-hash key', () => {
    const { client } = fakeClient();
    const store = new AvatarStore({ ...CONFIG, keyPrefix: undefined }, client);
    const hash = 'c'.repeat(64);
    assert.equal(store.avatarUrl(hash), `https://pub-test.r2.dev/${hash}`);
  });

  it('avatarStoreConfigFromEnv throws when a required var is missing', () => {
    const keys = [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_AVATARS_BUCKET',
      'R2_AVATARS_PUBLIC_BASE_URL',
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      assert.throws(() => avatarStoreConfigFromEnv(), /Missing required env var/);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
