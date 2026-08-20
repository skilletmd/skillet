// Drift guard: the scan cache versions must move when the detector corpus does.
//
// Both scan caches are keyed on a version integer (threat: DETECTOR_CORPUS_VERSION;
// capability: CAPABILITY_VERSION). If a detector is added/removed/renamed without
// bumping its lane's version, already-scanned content keeps serving stale results
// forever — a silent miss (exactly the bug the output-injection detector shipped
// with in review: a new threat category + new capability, only one lane bumped).
//
// This test recomputes a fingerprint of the committed detector inventory and
// asserts it matches the value pinned NEXT TO each version constant. Change the
// detector set → the fingerprint changes → this fails → you must update the pinned
// fingerprint AND bump the adjacent version, in one commit. The pin and the
// version live on adjacent lines so the bump can't be missed.
//
// Scope: catches detector-set changes (add/remove/rename a detector or category,
// add/remove a capability). A pure regex edit inside an existing detector does
// not change the inventory names and still relies on the doc rule on each version
// constant ("bump on any logic change").
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DETECTOR_CORPUS_VERSION, THREAT_CORPUS_FINGERPRINT } from '../src/scanner/cache.js';
import { CAPABILITY_VERSION, CAPABILITY_CORPUS_FINGERPRINT } from '../src/scanner/capabilities/scan.js';

const inventory = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../web/src/lib/scan-detector-inventory.json', import.meta.url)),
    'utf8',
  ),
) as { threatCategories: Record<string, { whyTags: string[] }>; capabilities: string[] };

function fp(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

describe('corpus version drift guard', () => {
  it('THREAT_CORPUS_FINGERPRINT matches the committed threat detector set', () => {
    const whyTags = Object.values(inventory.threatCategories)
      .flatMap((c) => c.whyTags)
      .sort();
    assert.equal(
      fp(whyTags),
      THREAT_CORPUS_FINGERPRINT,
      `The threat detector set changed. Update THREAT_CORPUS_FINGERPRINT in cache.ts to ${fp(
        whyTags,
      )} AND bump DETECTOR_CORPUS_VERSION (currently ${DETECTOR_CORPUS_VERSION}) in the same commit — a stale cache version is a silent scan miss.`,
    );
  });

  it('CAPABILITY_CORPUS_FINGERPRINT matches the committed capability set', () => {
    const caps = [...inventory.capabilities].sort();
    assert.equal(
      fp(caps),
      CAPABILITY_CORPUS_FINGERPRINT,
      `The capability set changed. Update CAPABILITY_CORPUS_FINGERPRINT in capabilities/scan.ts to ${fp(
        caps,
      )} AND bump CAPABILITY_VERSION (currently ${CAPABILITY_VERSION}) in the same commit.`,
    );
  });
});
