// The backfill writes public copy attached to real people's names, so its
// selection and skip rules matter more than its throughput. Phrasing is
// injected; nothing here shells out to the CLI.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backfillSuggestions } from '../scripts/backfill-suggestions.js';
import type { SuggestionCluster } from '../src/suggestions/cluster.js';

interface FakeAuthor {
  id: string;
  suggestions: string | null;
  suggestions_edited_at: number | null;
}

/** Minimal Prisma stand-in: only the three calls the backfill makes. */
function fakePrisma(authors: FakeAuthor[], skillsByAuthor: Record<string, unknown[]>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    authors: {
      findMany: async (args: any) => {
        let rows = [...authors];
        if (args.where?.id) rows = rows.filter((a) => a.id === args.where.id);
        if ('suggestions' in (args.where ?? {}) && args.where.suggestions === null) {
          rows = rows.filter((a) => a.suggestions === null);
        }
        rows.sort((a, b) => (a.id < b.id ? -1 : 1));
        return args.take ? rows.slice(0, args.take) : rows;
      },
      update: async (args: any) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
    skills: {
      findMany: async (args: any) => skillsByAuthor[args.where.author_id] ?? [],
    },
  };
  return { prisma: prisma as never, updates };
}

const kit = (n: number, category: string) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `${category}-${i}`,
    description: `${category} thing ${i}`,
    category,
    install_count: i,
    created_at: i,
  }));

const phraseAll = async (clusters: SuggestionCluster[]) =>
  clusters.map((c) => ({ task: `do ${c.category}`, ref: c.representative.ref }));

describe('backfillSuggestions', () => {
  it('generates and stores a set for an author with a clusterable kit', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'phuryn', suggestions: null, suggestions_edited_at: null }],
      { phuryn: kit(6, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { phrase: phraseAll });

    assert.equal(stats.generated, 1);
    assert.equal(updates.length, 1);
    const stored = JSON.parse(updates[0]!.data['suggestions'] as string);
    assert.equal(stored.suggestions[0].task, 'do product');
    assert.equal(stored.suggestions[0].ref, '@phuryn/product-5');
    assert.ok(stored.kit_signature.startsWith('6|'));
    assert.ok(typeof updates[0]!.data['suggestions_generated_at'] === 'number');
  });

  it('stores an EMPTY set for a kit too thin to speak for anyone', async () => {
    // Storing empty is what stops the next run paying for this author again.
    const { prisma, updates } = fakePrisma(
      [{ id: 'solo', suggestions: null, suggestions_edited_at: null }],
      { solo: kit(1, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { phrase: phraseAll });

    assert.equal(stats.empty, 1);
    assert.equal(stats.generated, 0);
    assert.deepEqual(JSON.parse(updates[0]!.data['suggestions'] as string).suggestions, []);
  });

  it('never regenerates over an author who edited their own lines', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'claimed', suggestions: null, suggestions_edited_at: 1700000000 }],
      { claimed: kit(6, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { phrase: phraseAll });

    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });

  it('skips an edited author even under --all', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'claimed', suggestions: '{"suggestions":[],"kit_signature":"x"}', suggestions_edited_at: 1 }],
      { claimed: kit(6, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { all: true, phrase: phraseAll });

    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });

  it('selects only never-generated authors by default', async () => {
    const { prisma, updates } = fakePrisma(
      [
        { id: 'done', suggestions: '{"suggestions":[],"kit_signature":"x"}', suggestions_edited_at: null },
        { id: 'todo', suggestions: null, suggestions_edited_at: null },
      ],
      { done: kit(6, 'product'), todo: kit(6, 'devops') },
    );
    const stats = await backfillSuggestions(prisma, { phrase: phraseAll });

    assert.equal(stats.authors, 1);
    assert.deepEqual(updates.map((u) => u.id), ['todo']);
  });

  it('is idempotent: a second run over the same catalog does no work', async () => {
    const authors: FakeAuthor[] = [{ id: 'a', suggestions: null, suggestions_edited_at: null }];
    const { prisma, updates } = fakePrisma(authors, { a: kit(6, 'product') });

    let calls = 0;
    const counting = async (c: SuggestionCluster[]) => {
      calls++;
      return phraseAll(c);
    };
    await backfillSuggestions(prisma, { phrase: counting });
    authors[0]!.suggestions = updates[0]!.data['suggestions'] as string;
    await backfillSuggestions(prisma, { phrase: counting });

    assert.equal(calls, 1);
    assert.equal(updates.length, 1);
  });

  it('counts a phrasing failure and moves on rather than aborting the run', async () => {
    const { prisma, updates } = fakePrisma(
      [
        { id: 'boom', suggestions: null, suggestions_edited_at: null },
        { id: 'fine', suggestions: null, suggestions_edited_at: null },
      ],
      { boom: kit(6, 'product'), fine: kit(6, 'devops') },
    );
    const stats = await backfillSuggestions(prisma, {
      phrase: async (c) => {
        if (c[0]!.representative.ref.startsWith('@boom/')) throw new Error('claude exited 1');
        return phraseAll(c);
      },
    });

    assert.equal(stats.failed, 1);
    assert.equal(stats.generated, 1);
    // The failed author stays null, so the next run retries them.
    assert.deepEqual(updates.map((u) => u.id), ['fine']);
  });

  it('--dry-run writes nothing', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { dryRun: true, phrase: phraseAll });

    assert.equal(stats.generated, 1);
    assert.equal(updates.length, 0);
  });

  it('--handle restricts the run to one author', async () => {
    const { prisma, updates } = fakePrisma(
      [
        { id: 'a', suggestions: null, suggestions_edited_at: null },
        { id: 'b', suggestions: null, suggestions_edited_at: null },
      ],
      { a: kit(6, 'product'), b: kit(6, 'devops') },
    );
    await backfillSuggestions(prisma, { handle: 'b', phrase: phraseAll });
    assert.deepEqual(updates.map((u) => u.id), ['b']);
  });

  it('every stored ref belongs to the author it was stored on', async () => {
    // The generation probe once carried another author's ref onto a profile.
    const { prisma, updates } = fakePrisma(
      [{ id: 'wshobson', suggestions: null, suggestions_edited_at: null }],
      { wshobson: [...kit(4, 'devops'), ...kit(4, 'frontend')] },
    );
    await backfillSuggestions(prisma, { phrase: phraseAll });
    for (const s of JSON.parse(updates[0]!.data['suggestions'] as string).suggestions) {
      assert.ok(s.ref.startsWith('@wshobson/'), s.ref);
    }
  });
});
