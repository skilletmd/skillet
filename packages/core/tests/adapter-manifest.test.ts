import { describe, expect, it } from 'vitest'
import {
  adapterManifestVerifyOptions,
  deriveAdapterContentHash,
  verifyAdapterManifest,
  type AdapterEntry,
} from '../src/adapters/manifest.js'

const adapters: AdapterEntry[] = [
  {
    detect: '~/.hermes',
    key: 'hermes',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.hermes/skills',
    version: '1.0.0',
  },
]

describe('verifyAdapterManifest production gate', () => {
  it('refuses unsigned manifests when production options are used', () => {
    const opts = { ...adapterManifestVerifyOptions(), allowUnsigned: false }
    expect(() =>
      verifyAdapterManifest(
        { adapters, content_hash: 'sha256:' + 'ab'.repeat(32), signature: null },
        opts,
      ),
    ).toThrow(/unsigned/)
  })

  it('allows unsigned manifests in dev when allowUnsigned is true', () => {
    const content_hash = deriveAdapterContentHash(adapters);
    expect(() =>
      verifyAdapterManifest(
        {
          adapters,
          content_hash,
          signature: null,
        },
        { allowUnsigned: true },
      ),
    ).not.toThrow();
  });
})
