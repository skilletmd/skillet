import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_SCHEMA_VERSION,
  isSupportedArtifactSchemaVersion,
  resolveArtifactSchemaVersion,
} from '../src/artifact-schema.js';

describe('artifact schema version', () => {
  it('exports current version as 1', () => {
    assert.equal(ARTIFACT_SCHEMA_VERSION, 1);
  });

  it('treats missing schema_version as legacy v1', () => {
    assert.equal(resolveArtifactSchemaVersion(undefined, 'test'), 1);
    assert.equal(resolveArtifactSchemaVersion(null, 'test'), 1);
  });

  it('accepts explicit v1', () => {
    assert.equal(resolveArtifactSchemaVersion(1, 'test'), 1);
    assert.equal(isSupportedArtifactSchemaVersion(1), true);
  });

  it('rejects unknown future versions', () => {
    assert.throws(
      () => resolveArtifactSchemaVersion(99, 'manifest'),
      /unsupported artifact schema_version/,
    );
    assert.equal(isSupportedArtifactSchemaVersion(2), false);
  });
});
