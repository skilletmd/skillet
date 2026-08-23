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
