import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionAdapters } from '../src/cli-add-adapters.js';

test('partitionAdapters returns all detected as additional', () => {
  const detected = [
    { name: 'claude-code', label: 'Claude Code', pathHint: '~/.claude/skills' },
    { name: 'cursor', label: 'Cursor', pathHint: '.cursor/rules' },
  ];
  const parts = partitionAdapters(detected as never);
  assert.equal(parts.additional.length, 2);
});
