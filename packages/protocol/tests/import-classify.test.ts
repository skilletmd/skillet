import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isExcludedDiscoveryPath, isCoupledSkillMarkdown, classifyImport } from '../src/import-classify.js'

describe('isExcludedDiscoveryPath', () => {
  it('discovers a plain skill path', () => {
    assert.equal(isExcludedDiscoveryPath('skills/engineering/foo/SKILL.md'), false)
    assert.equal(isExcludedDiscoveryPath('SKILL.md'), false)
  })

  it('excludes course and tutorial lesson artifacts', () => {
    // rohitg00/ai-engineering-from-scratch is a 503-lesson curriculum. Six of
    // the fourteen SKILL.md files it offered were outputs a *student* produces
    // doing a lesson, not skills the author publishes.
    assert.equal(
      isExcludedDiscoveryPath(
        'phases/13-tools-and-protocols/27-skill-evals-packaging-and-portability/outputs/skill-release-gate/SKILL.md',
      ),
      true,
    )
    assert.equal(
      isExcludedDiscoveryPath(
        'certifications/claude/lessons/19-claude-code-memory-rules-skills-and-ci/outputs/migration-review-skill/SKILL.md',
      ),
      true,
    )
  })

  it('leaves that same repo\'s real skills alone', () => {
    assert.equal(isExcludedDiscoveryPath('skills/check-understanding/SKILL.md'), false)
    assert.equal(isExcludedDiscoveryPath('skills/claude-certification/SKILL.md'), false)
  })

  it('matches whole segments, so a skill named for one survives', () => {
    // The rule is segment equality, never substring: a skill about writing
    // lesson plans or reviewing solutions keeps its place.
    assert.equal(isExcludedDiscoveryPath('skills/lesson-planner/SKILL.md'), false)
    assert.equal(isExcludedDiscoveryPath('skills/solutions-architect/SKILL.md'), false)
    assert.equal(isExcludedDiscoveryPath('skills/output-formatter/SKILL.md'), false)
  })

  it('keeps examples/, where eleven real skills live', () => {
    assert.equal(isExcludedDiscoveryPath('examples/skills/cognee-mcp/SKILL.md'), false)
  })

  it('excludes any dot-prefixed segment (tool mirrors, VCS/CI)', () => {
    assert.equal(isExcludedDiscoveryPath('.claude/skills/foo/SKILL.md'), true)
    assert.equal(isExcludedDiscoveryPath('.github/foo/SKILL.md'), true)
    assert.equal(isExcludedDiscoveryPath('skills/.out-of-scope/foo/SKILL.md'), true)
  })

  it('excludes build/output/dependency dirs', () => {
    for (const seg of ['node_modules', 'dist', 'build', 'out', 'vendor']) {
      assert.equal(isExcludedDiscoveryPath(`${seg}/foo/SKILL.md`), true)
    }
  })

  it('excludes the "not ready" / "retired" holding pens so WIP never mirrors', () => {
    assert.equal(isExcludedDiscoveryPath('skills/in-progress/writing-beats/SKILL.md'), true)
    assert.equal(isExcludedDiscoveryPath('skills/deprecated/old-thing/SKILL.md'), true)
    // Match is per-segment and case-insensitive, not a substring.
    assert.equal(isExcludedDiscoveryPath('skills/In-Progress/foo/SKILL.md'), true)
    assert.equal(isExcludedDiscoveryPath('skills/work-in-progress-notes/SKILL.md'), false)
  })
})

describe('isCoupledSkillMarkdown', () => {
  it('flags a real parent reference', () => {
    assert.equal(isCoupledSkillMarkdown('see [x](../shared/util.md)'), true)
    assert.equal(isCoupledSkillMarkdown('read ../sibling-skill/SKILL.md'), true)
    assert.equal(isCoupledSkillMarkdown('cat /tmp/foo/../bar'), true)
  })

  it('does NOT flag an ellipsis (.../) placeholder', () => {
    // The regression: everyinc/compound-engineering ce-code-review's only "../"
    // was the ellipsis in `/tmp/.../ce-code-review/<run-id>/`. Self-contained.
    assert.equal(isCoupledSkillMarkdown('artifacts land in `/tmp/.../ce-code-review/<run-id>/`'), false)
    assert.equal(isCoupledSkillMarkdown('e.g. path/to/.../thing'), false)
  })

  it('does NOT flag a markdown link to a sibling skill (a citation)', () => {
    // Jakubantalik/transitions.dev: two standalone skills, each with its own
    // _root.css, tipped to `unified` by one line of prose. A sibling's SKILL.md
    // is that skill's entry point, not an asset this one loads.
    assert.equal(
      isCoupledSkillMarkdown('An **add-on** to the [`transitions-dev`](../transitions-dev/SKILL.md) skill.'),
      false,
    )
    assert.equal(isCoupledSkillMarkdown('see [polish](../../other/SKILL.md) too'), false)
  })

  it('still flags a shared asset alongside a sibling citation', () => {
    assert.equal(
      isCoupledSkillMarkdown('[a](../sibling/SKILL.md) and tokens in ../shared/_root.css'),
      true,
    )
  })

  it('does NOT flag a self-contained skill (SKILL_DIR-relative refs)', () => {
    assert.equal(isCoupledSkillMarkdown('run "$SKILL_DIR/scripts/review.py" and references/personas/*'), false)
  })
})

describe('classifyImport', () => {
  it('a repo of self-contained skills is a kit, not unified', () => {
    // 39 independent ce-* skills (post-fix: the ellipsis no longer couples one).
    const skills = Array.from({ length: 39 }, (_, i) => ({ dir: `skills/ce-${i}`, coupled: false }))
    assert.equal(classifyImport(skills).mode, 'kit')
  })

  it('one genuinely coupled skill tips the repo to unified', () => {
    assert.equal(
      classifyImport([
        { dir: 'skills/a', coupled: false },
        { dir: 'skills/b', coupled: true },
      ]).mode,
      'unified',
    )
  })
})
