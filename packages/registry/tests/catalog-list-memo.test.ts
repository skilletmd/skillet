import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogListMemoKey,
  createCatalogListMemo,
} from '../src/lib/catalog-list-memo.js';

describe('catalogListMemoKey', () => {
  it('sorts query keys and drops empties', () => {
    assert.equal(
      catalogListMemoKey('skills', { b: '2', a: '1', empty: '', skip: undefined }),
      'skills&a=1&b=2',
    );
  });
});

describe('createCatalogListMemo', () => {
  it('joins concurrent identical keys into one loader call', async () => {
    let calls = 0;
    const memo = createCatalogListMemo({ ttlMs: 60_000 });
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { n: calls };
    };

    const [a, b, c] = await Promise.all([
      memo.getOrLoad('k', loader),
      memo.getOrLoad('k', loader),
      memo.getOrLoad('k', loader),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(a, { n: 1 });
    assert.deepEqual(b, { n: 1 });
    assert.deepEqual(c, { n: 1 });
  });

  it('reloads after TTL expiry when clock advances', async () => {
    let now = 1_000;
    let calls = 0;
    const memo = createCatalogListMemo({
      ttlMs: 100,
      now: () => now,
    });

    await memo.getOrLoad('k', async () => {
      calls += 1;
      return calls;
    });
    assert.equal(calls, 1);

    now = 1_050;
    const again = await memo.getOrLoad('k', async () => {
      calls += 1;
      return calls;
    });
    assert.equal(calls, 1);
    assert.equal(again, 1);

    now = 1_200;
    const fresh = await memo.getOrLoad('k', async () => {
      calls += 1;
      return calls;
    });
    assert.equal(calls, 2);
    assert.equal(fresh, 2);
  });

  it('does not share results across different keys', async () => {
    const memo = createCatalogListMemo();
    const a = await memo.getOrLoad('a', async () => 'A');
    const b = await memo.getOrLoad('b', async () => 'B');
    assert.equal(a, 'A');
    assert.equal(b, 'B');
  });

  it('clear forces the next call to reload', async () => {
    let calls = 0;
    const memo = createCatalogListMemo();
    await memo.getOrLoad('k', async () => {
      calls += 1;
      return calls;
    });
    memo.clear();
    const next = await memo.getOrLoad('k', async () => {
      calls += 1;
      return calls;
    });
    assert.equal(calls, 2);
    assert.equal(next, 2);
  });

  it('bounds store size under many unique keys', async () => {
    const maxEntries = 8;
    const memo = createCatalogListMemo({ maxEntries, ttlMs: 60_000 });
    for (let i = 0; i < 40; i++) {
      await memo.getOrLoad(`k-${i}`, async () => i);
    }
    assert.ok(memo.size() <= maxEntries, `size ${memo.size()} exceeds ${maxEntries}`);
  });
});
