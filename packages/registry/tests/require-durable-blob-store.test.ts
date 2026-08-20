import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertDurableBlobStoreForProd } from '../src/mirror-ops/require-durable-blob-store.js'

describe('assertDurableBlobStoreForProd', () => {
  it('allows memory outside production', () => {
    assert.doesNotThrow(() =>
      assertDurableBlobStoreForProd({ NODE_ENV: 'test', BLOB_STORE: 'memory' }, 'memory'),
    )
  })

  it('rejects memory in production', () => {
    assert.throws(
      () => assertDurableBlobStoreForProd({ NODE_ENV: 'production', BLOB_STORE: 'memory' }, 'memory'),
      /BLOB_STORE resolved to memory/,
    )
  })

  it('allows memory in production with explicit override', () => {
    assert.doesNotThrow(() =>
      assertDurableBlobStoreForProd(
        {
          NODE_ENV: 'production',
          BLOB_STORE: 'memory',
          SKILLET_ALLOW_MEMORY_BLOB_STORE: '1',
        },
        'memory',
      ),
    )
  })

  it('allows r2 in production', () => {
    assert.doesNotThrow(() =>
      assertDurableBlobStoreForProd({ NODE_ENV: 'production', BLOB_STORE: 'r2' }, 'r2'),
    )
  })
})
