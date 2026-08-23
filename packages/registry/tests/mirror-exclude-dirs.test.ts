/**
 * `excludeDirs` is the per-source lever for a good repo that also carries a
 * demo or linter corpus.
 *
 * The global fixture-segment rule (EXCLUDED_DISCOVERY_SEGMENTS) cannot reach
 * flutter/agent-plugins' linter corpus at `tool/dart_skills_lint/example/skills/
 * {valid,invalid}` — the only distinguishing segment is `example`, and eleven
 * live skills across topoteretes/cognee and tradermonty/claude-trading-skills
 * are REAL skills that happen to sit under `examples/`. A global `example`
 * exclusion would take those eleven to remove two fixtures. Hence a per-source
 * path list, verified here to be prefix-scoped and boundary-safe.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSources } from '../src/mirror-ops/sync-sources.js';

/** Mirrors the filter in syncRepoSkillsPrisma. */
function applyExclude(dirs: string[], exclude: string[]): string[] {
    return dirs.filter((d) => !exclude.some((x) => d === x || d.startsWith(`${x}/`)));
}

test('excludes the named dir and everything under it', () => {
    const kept = applyExclude([
        'skills/dart-add-unit-test',
        'tool/dart_skills_lint/example',
        'tool/dart_skills_lint/example/skills/valid',
        'tool/dart_skills_lint/example/skills/invalid',
    ], ['tool/dart_skills_lint/example']);
    assert.deepEqual(kept, ['skills/dart-add-unit-test']);
});

test('matches on a path boundary, not a bare string prefix', () => {
    // `example-app` must survive an `example` exclusion — otherwise the lever
    // silently eats sibling dirs whose names merely start the same way.
    const kept = applyExclude(['example-app/skills/a', 'example/skills/b'], ['example']);
    assert.deepEqual(kept, ['example-app/skills/a']);
});

test('no excludeDirs is a no-op', () => {
    const dirs = ['a', 'b/c'];
    assert.deepEqual(applyExclude(dirs, []), dirs);
});

test('the flutter seed excludes its linter corpus', () => {
    const flutter = loadSources().find((s) => s.repo === 'flutter/agent-plugins');
    assert.ok(flutter, 'flutter/agent-plugins is still a seeded source');
    assert.deepEqual(flutter.excludeDirs, ['tool/dart_skills_lint/example']);
});

test('excludeDirs stays rare — a global rule is the right fix past a handful', () => {
    // Not a style rule. Every entry here is knowledge about one repo's tree that
    // nothing re-verifies when that repo restructures. If this grows, the shape
    // being excluded has become common enough to name globally instead.
    const withExcludes = loadSources().filter((s) => (s.excludeDirs?.length ?? 0) > 0);
    assert.ok(withExcludes.length <= 3, `${withExcludes.length} sources carry excludeDirs; prefer a global segment rule`);
});
