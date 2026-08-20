// Conventional Commits, tuned to this repo. See CONTRIBUTING.md → "Commits".
// Local enforcement: .husky/commit-msg. CI enforcement (the real gate for
// contributors): .github/workflows/pr-title.yml lints the squash-merge title.
// The same type vocabulary feeds release-please's changelog sections
// (release-please-config.json).
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Standard set + `polish`/`refine`, which this repo uses for user-facing
    // copy/UI tightening. They land under "Changed" in the changelog but never
    // drive a version bump on their own (only feat/fix/BREAKING do).
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert', 'polish', 'refine'],
    ],
    // Scope = the package the change lives in. A warning, not an error — plenty
    // of legitimate commits are cross-cutting or scopeless.
    'scope-enum': [
      1,
      'always',
      ['cli', 'registry', 'web', 'core', 'protocol', 'desktop', 'mcp', 'adapters', 'sync', 'ci', 'deps', 'release', 'docs'],
    ],
    'header-max-length': [2, 'always', 100],
  },
};
