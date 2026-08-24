import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isExcludedDiscoveryPath } from '../src/import-classify.js'

/**
 * A repo's own test fixtures are not skills. EveryInc/compound-engineering-plugin
 * ships five under tests/fixtures/ to exercise its loader, and they published
 * under @every as if real — two of them with no description at all.
 */
describe('fixture directories are not discovered', () => {
  it('excludes a skill under a test or fixture tree', () => {
    for (const p of [
      'tests/fixtures/sample-plugin/skills/skill-one/SKILL.md',
      'tests/fixtures/custom-paths/skills/default-skill/SKILL.md',
      'test/fixtures/context-bill/tree-a/alpha/SKILL.md',
      'e2e/skills/thing/SKILL.md',
      '__tests__/skills/thing/SKILL.md',
      '__fixtures__/a/SKILL.md',
    ]) {
      assert.equal(isExcludedDiscoveryPath(p), true, p)
    }
  })

  // The rule matches whole SEGMENTS, which is what keeps a skill ABOUT testing.
  // flutter/agent-plugins ships four of these and they must survive.
  it('keeps a genuine skill whose NAME mentions testing', () => {
    for (const p of [
      'skills/dart-add-unit-test/SKILL.md',
      'skills/flutter-add-widget-test/SKILL.md',
      'skills/dart-generate-test-mocks/SKILL.md',
      'skills/ce-test-browser/SKILL.md',
      'skills/testing-strategy/SKILL.md',
      'skills/e2e-testing-patterns/SKILL.md',
    ]) {
      assert.equal(isExcludedDiscoveryPath(p), false, p)
    }
  })

  // `spec` is deliberately NOT excluded — a skill legitimately named `spec` is
  // plausible in a way `__tests__` is not.
  it('does not exclude a skill named spec', () => {
    assert.equal(isExcludedDiscoveryPath('skills/spec/SKILL.md'), false)
    assert.equal(isExcludedDiscoveryPath('spec/SKILL.md'), false)
  })
})

// mvanhorn/cli-printing-press: 21 SKILL.md files, 9 real under skills/ and 12
// golden-output fixtures under testdata/. Only two of the twelve sat under a
// `fixtures` segment; the other ten were testdata/golden/expected/…, which the
// original list did not reach.
describe('reserved test-data directories are not discovered', () => {
  it('excludes testdata and __snapshots__ trees', () => {
    for (const p of [
      'testdata/golden/expected/generate-device-ble/ble-temperature-sensor/SKILL.md',
      'testdata/golden/fixtures/dogfood-novel-doc-sync/cli/SKILL.md',
      'src/__snapshots__/render/SKILL.md',
    ])
      assert.equal(isExcludedDiscoveryPath(p), true, `${p} should be excluded`)
  })

  it('keeps real skills beside them, including one NAMED for test data', () => {
    // Segment matching, not substring matching, is the whole safety property.
    for (const p of [
      'skills/printing-press-publish/SKILL.md',
      'skills/printing-press-score/SKILL.md',
      'skills/generate-testdata-helper/SKILL.md',
    ])
      assert.equal(isExcludedDiscoveryPath(p), false, `${p} should be kept`)
  })
})
