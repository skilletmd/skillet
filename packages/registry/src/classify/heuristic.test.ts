import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory } from './heuristic.js';

describe('guessCategory', () => {
  it('maps real compound-engineering skills to sensible categories', () => {
    assert.equal(
      guessCategory({ slug: 'ce-test-xcode', description: 'Build and test iOS apps on simulator with XcodeBuildMCP.' }),
      'mobile',
    );
    assert.equal(
      guessCategory({ slug: 'ce-commit', description: 'Create a git commit with a clear, value-communicating message.' }),
      'devops',
    );
    assert.equal(
      guessCategory({ slug: 'ce-brainstorm', description: 'Explore vague ideas into a right-sized requirements-only unified plan.' }),
      'product',
    );
    assert.equal(
      guessCategory({ slug: 'ce-code-review', description: 'Structured code review for bugs, regressions, tests, and standards.' }),
      'quality',
    );
  });

  it('weights slug/description over body', () => {
    // Body mentions react once; description clearly names a database task.
    const cat = guessCategory({
      slug: 'schema-migrator',
      description: 'Generate SQL migrations from a Postgres schema.',
      body: 'This can run inside a react app too.',
    });
    assert.equal(cat, 'database');
  });

  it('returns null when nothing matches (stays uncategorized, not mis-filed)', () => {
    assert.equal(guessCategory({ slug: 'zxqw', description: 'lorem ipsum dolor sit' }), null);
    assert.equal(guessCategory({ slug: '', description: '', body: '' }), null);
  });

  it('does not substring-match (ad ≠ add, design ≠ redesign)', () => {
    assert.equal(guessCategory({ slug: 'add-numbers', description: 'add two numbers together' }), null);
  });
});
