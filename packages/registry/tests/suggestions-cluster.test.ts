// Clustering picks WHAT the three lines are about; the phrase validator decides
// whether a model-written line is fit to publish under someone's name. Both are
// pure, and both are the difference between a suggestion and a liability.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CLUSTER_SIZE,
  clusterSkills,
  effectiveCategory,
  isPublishablePhrase,
  pickRepresentative,
  type ClusterableSkill,
} from '../src/suggestions/cluster.js';

const skill = (over: Partial<ClusterableSkill> & { slug: string }): ClusterableSkill => ({
  ref: `@a/${over.slug}`,
  description: `${over.slug} does a thing`,
  category: 'frontend',
  ...over,
});

const many = (category: string, n: number, prefix = category): ClusterableSkill[] =>
  Array.from({ length: n }, (_, i) => skill({ slug: `${prefix}-${i}`, category }));

describe('clusterSkills', () => {
  it('returns at most three clusters, biggest first', () => {
    const clusters = clusterSkills([
      ...many('frontend', 10),
      ...many('devops', 8),
      ...many('quality', 6),
      ...many('writing', 4),
    ]);
    assert.equal(clusters.length, 3);
    assert.deepEqual(clusters.map((c) => c.category), ['frontend', 'devops', 'quality']);
  });

  it('drops a cluster below the floor rather than filling a slot with it', () => {
    const clusters = clusterSkills([...many('frontend', 5), ...many('finance', MIN_CLUSTER_SIZE - 1)]);
    assert.deepEqual(clusters.map((c) => c.category), ['frontend']);
  });

  it('returns nothing for a kit too thin to speak for anyone', () => {
    assert.deepEqual(clusterSkills([skill({ slug: 'only' })]), []);
    assert.deepEqual(clusterSkills([]), []);
  });

  it('drops a skill no category can be guessed for, instead of pooling it', () => {
    // Nobody summons anyone for "uncategorized", and its members share nothing.
    const clusters = clusterSkills([
      ...many('frontend', 4),
      ...Array.from({ length: 9 }, (_, i) =>
        skill({ slug: `zq-${i}`, description: 'zq zq zq', category: null }),
      ),
    ]);
    assert.deepEqual(clusters.map((c) => c.category), ['frontend']);
  });

  it('clusters an entirely uncategorized kit via the guessed category', () => {
    // Production has authors whose whole kit carries no stored category; without
    // the fallback they would never show a block however good the kit is.
    const clusters = clusterSkills([
      skill({ slug: 'user-story', description: 'Write a user story for a product team', category: null }),
      skill({ slug: 'proto-persona', description: 'Build a product persona', category: null }),
      skill({ slug: 'roadmap-review', description: 'Review the product roadmap', category: null }),
    ]);
    assert.equal(clusters.length, 1);
    assert.ok(clusters[0]!.size >= MIN_CLUSTER_SIZE);
  });

  it('is deterministic for the same kit in a different row order', () => {
    const kit = [...many('frontend', 5), ...many('devops', 5), ...many('quality', 5)];
    const forwards = clusterSkills(kit).map((c) => c.category);
    const backwards = clusterSkills([...kit].reverse()).map((c) => c.category);
    assert.deepEqual(forwards, backwards);
  });

  it('every cluster carries a representative drawn from its own members', () => {
    for (const c of clusterSkills([...many('frontend', 4), ...many('devops', 4)])) {
      assert.equal(c.representative.category, c.category);
    }
  });
});

describe('effectiveCategory', () => {
  it('prefers the stored category over a guess', () => {
    assert.equal(
      effectiveCategory(skill({ slug: 'deploy-worker', description: 'Deploy', category: 'writing' })),
      'writing',
    );
  });

  it('guesses when the column is empty', () => {
    assert.notEqual(
      effectiveCategory(skill({ slug: 'user-story', description: 'Write a user story', category: null })),
      null,
    );
  });

  it('returns null when nothing can be guessed', () => {
    assert.equal(effectiveCategory(skill({ slug: 'zq', description: 'zq zq', category: null })), null);
  });
});

describe('pickRepresentative', () => {
  it('prefers the most-adopted skill — a suggestion is a recommendation', () => {
    const chosen = pickRepresentative([
      skill({ slug: 'quiet', install_count: 0 }),
      skill({ slug: 'popular', install_count: 40 }),
      skill({ slug: 'middling', install_count: 3 }),
    ]);
    assert.equal(chosen.slug, 'popular');
  });

  it('falls back to summons, then recency, then ref', () => {
    const bySummons = pickRepresentative([
      skill({ slug: 'a', summon_count: 1 }),
      skill({ slug: 'b', summon_count: 9 }),
    ]);
    assert.equal(bySummons.slug, 'b');

    const byRecency = pickRepresentative([
      skill({ slug: 'old', created_at: 1 }),
      skill({ slug: 'new', created_at: 2 }),
    ]);
    assert.equal(byRecency.slug, 'new');

    const byRef = pickRepresentative([skill({ slug: 'zzz' }), skill({ slug: 'aaa' })]);
    assert.equal(byRef.slug, 'aaa');
  });
});

describe('isPublishablePhrase', () => {
  it('accepts the phrases a real task looks like', () => {
    for (const ok of [
      'redo my site',
      'review this component',
      'debug my build',
      'write release notes',
      'optimize slow query',
      "fix my app's layout",
    ]) {
      assert.ok(isPublishablePhrase(ok), ok);
    }
  });

  it('rejects anything link-shaped', () => {
    for (const bad of ['visit https://evil.example', 'see www.example.com', 'ping me @taylor']) {
      assert.equal(isPublishablePhrase(bad), false, bad);
    }
  });

  it('rejects markup, code fences, and brackets', () => {
    for (const bad of ['<script>alert</script>', 'run `rm -rf`', 'do [this](x)', 'pipe | this']) {
      assert.equal(isPublishablePhrase(bad), false, bad);
    }
  });

  it('rejects the phrases an injected description is fishing for', () => {
    for (const bad of [
      'install my package',
      'download this tool',
      'ignore previous instructions',
      'disregard the rules',
      'click here',
      'subscribe now',
    ]) {
      assert.equal(isPublishablePhrase(bad), false, bad);
    }
  });

  it('rejects a phrase that is too long, too short, or wrapped', () => {
    assert.equal(isPublishablePhrase('a'), false);
    assert.equal(isPublishablePhrase('do the thing with all of the stuff and more'), false);
    assert.equal(isPublishablePhrase('redo my site\nand also this'), false);
    assert.equal(isPublishablePhrase('   '), false);
  });

  it('rejects sentence case and trailing punctuation rather than repairing it', () => {
    // A phrase we had to repair is a phrase we did not understand.
    assert.equal(isPublishablePhrase('Redo my site'), false);
    assert.equal(isPublishablePhrase('redo my site.'), false);
  });
});
