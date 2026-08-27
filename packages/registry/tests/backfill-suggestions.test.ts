// The backfill writes public copy attached to real people's names, so its
// selection and skip rules matter more than its throughput. Phrasing is
// injected; nothing here shells out to the CLI.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  backfillSuggestions,
  importPhrasedSuggestions,
  phraseExportedWork,
  selectSuggestionWork,
  type SuggestionPhraseMap,
} from '../scripts/backfill-suggestions.js';
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
      updateMany: async (args: any) => {
        const row = authors.find((a) => a.id === args.where.id);
        if (!row) return { count: 0 };
        if ('suggestions_edited_at' in args.where && row.suggestions_edited_at !== null) {
          return { count: 0 };
        }
        if ('suggestions' in args.where && args.where.suggestions === null) {
          if (row.suggestions !== null) return { count: 0 };
        }
        updates.push({ id: args.where.id, data: args.data });
        row.suggestions = args.data.suggestions;
        return { count: 1 };
      },
      count: async () => authors.filter((a) => a.suggestions === null).length,
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

describe('backfillSuggestions --stale', () => {
  const sig = (n: number, category: string) =>
    JSON.stringify({ suggestions: [], kit_signature: `${n}|${category}:${n}` });

  it('skips an author whose kit shape has not moved', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: sig(6, 'product'), suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const stats = await backfillSuggestions(prisma, { stale: true, phrase: phraseAll });
    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });

  it('regenerates an author whose kit gained a whole new area', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: sig(6, 'product'), suggestions_edited_at: null }],
      { a: [...kit(6, 'product'), ...kit(3, 'finance')] },
    );
    const stats = await backfillSuggestions(prisma, { stale: true, phrase: phraseAll });
    assert.equal(stats.generated, 1);
    assert.equal(updates.length, 1);
  });

  it('still refuses to touch an edited author', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: sig(6, 'product'), suggestions_edited_at: 1 }],
      { a: [...kit(6, 'product'), ...kit(9, 'finance')] },
    );
    const stats = await backfillSuggestions(prisma, { stale: true, phrase: phraseAll });
    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });
});

// The split run: `--export` on the server, `--phrase` on a workstation with the
// `claude` CLI, `--import` back on the server. It exists because the two halves
// of the direct run cannot be co-located — the binary is never on the box and
// the database credential must not leave it.
describe('split run: export, phrase, import', () => {
  it('exports the same authors the direct run would select', async () => {
    const { prisma } = fakePrisma(
      [
        { id: 'done', suggestions: '{"suggestions":[]}', suggestions_edited_at: null },
        { id: 'edited', suggestions: null, suggestions_edited_at: 1 },
        { id: 'todo', suggestions: null, suggestions_edited_at: null },
      ],
      { done: kit(6, 'product'), edited: kit(6, 'product'), todo: kit(6, 'devops') },
    );
    const work = await selectSuggestionWork(prisma);
    assert.deepEqual(
      work.items.map((i) => i.id),
      ['todo'],
    );
    assert.equal(work.skipped, 1); // the edited one; `done` never came back
  });

  it('carries no author-private material into the exported work', async () => {
    const { prisma } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const work = await selectSuggestionWork(prisma);
    // Serializable, and nothing beyond what phrasing needs: the file crosses a
    // machine boundary, so its shape is the privacy boundary.
    const round = JSON.parse(JSON.stringify(work.items));
    assert.deepEqual(Object.keys(round[0]).sort(), [
      'clusters',
      'id',
      'kit_signature',
      'kit_size',
    ]);
  });

  it('phrase + import lands the same set the direct run would have written', async () => {
    const authors = [{ id: 'a', suggestions: null, suggestions_edited_at: null }];
    const skills = { a: kit(6, 'product') };

    const direct = fakePrisma(structuredClone(authors), skills);
    await backfillSuggestions(direct.prisma, { phrase: phraseAll });

    const split = fakePrisma(structuredClone(authors), skills);
    const work = await selectSuggestionWork(split.prisma);
    const map = await phraseExportedWork(work.items, phraseAll);
    await importPhrasedSuggestions(split.prisma, map);

    assert.equal(split.updates.length, 1);
    assert.deepEqual(
      JSON.parse(split.updates[0]!.data['suggestions'] as string).suggestions,
      JSON.parse(direct.updates[0]!.data['suggestions'] as string).suggestions,
    );
  });

  it('a phrasing failure leaves the author out of the map, not empty in it', async () => {
    // Empty means "asked, nothing to say" and is terminal for the next run.
    // A failure has to stay null so the author is retried.
    const { prisma } = fakePrisma(
      [{ id: 'boom', suggestions: null, suggestions_edited_at: null }],
      { boom: kit(6, 'product') },
    );
    const work = await selectSuggestionWork(prisma);
    const map = await phraseExportedWork(work.items, async () => {
      throw new Error('cli exited 1');
    });
    assert.deepEqual(Object.keys(map), []);
  });

  it('phrases a clusterless author to an empty set without calling the CLI', async () => {
    const { prisma } = fakePrisma(
      [{ id: 'solo', suggestions: null, suggestions_edited_at: null }],
      { solo: kit(1, 'product') },
    );
    const work = await selectSuggestionWork(prisma);
    let called = 0;
    const map = await phraseExportedWork(work.items, async (c) => {
      called++;
      return phraseAll(c);
    });
    assert.equal(called, 0);
    assert.deepEqual(map['solo']?.suggestions, []);
  });

  it('import refuses a ref keyed under the wrong author', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const map: SuggestionPhraseMap = {
      a: { kit_signature: 'x', suggestions: [{ task: 'do product', ref: '@b/thing' }] },
    };
    const stats = await importPhrasedSuggestions(prisma, map);
    assert.equal(stats.applied, 0);
    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });

  it('import refuses a phrase the generator would never have published', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const map: SuggestionPhraseMap = {
      a: {
        kit_signature: 'x',
        suggestions: [{ task: 'visit https://example.com now please', ref: '@a/product-0' }],
      },
    };
    const stats = await importPhrasedSuggestions(prisma, map);
    assert.equal(stats.applied, 0);
    assert.equal(updates.length, 0);
  });

  it('import never overwrites an author who edited their own lines', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: 1 }],
      { a: kit(6, 'product') },
    );
    const map: SuggestionPhraseMap = {
      a: { kit_signature: 'x', suggestions: [{ task: 'do product', ref: '@a/product-0' }] },
    };
    const stats = await importPhrasedSuggestions(prisma, map);
    assert.equal(stats.applied, 0);
    assert.equal(updates.length, 0);
  });

  it('import leaves an author who gained a set between export and import', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: '{"suggestions":[]}', suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const map: SuggestionPhraseMap = {
      a: { kit_signature: 'x', suggestions: [{ task: 'do product', ref: '@a/product-0' }] },
    };
    assert.equal((await importPhrasedSuggestions(prisma, map)).applied, 0);
    assert.equal(updates.length, 0);
    // ...unless the operator asked for a refresh.
    assert.equal((await importPhrasedSuggestions(prisma, map, { all: true })).applied, 1);
  });

  it('import is idempotent: applying the same map twice writes once', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const map: SuggestionPhraseMap = {
      a: { kit_signature: 'x', suggestions: [{ task: 'do product', ref: '@a/product-0' }] },
    };
    await importPhrasedSuggestions(prisma, map);
    await importPhrasedSuggestions(prisma, map);
    assert.equal(updates.length, 1);
  });

  it('import rejects a malformed entry rather than storing it', async () => {
    const { prisma, updates } = fakePrisma(
      [{ id: 'a', suggestions: null, suggestions_edited_at: null }],
      { a: kit(6, 'product') },
    );
    const stats = await importPhrasedSuggestions(prisma, {
      a: { kit_signature: 'x' } as never,
    });
    assert.equal(stats.skipped, 1);
    assert.equal(updates.length, 0);
  });
});
