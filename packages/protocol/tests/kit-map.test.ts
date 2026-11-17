/**
 * The kit map's shapes cross four places: the CLI's loopback page, the framed
 * map on skillet.md, the save tab, and the registry's saved map. These pin what
 * each validator lets through (no paths, no usage in the saved map, no names in
 * a proof, no unknown versions) and what an ordered draft list means: a merge
 * loses the keys later drafts take out, a Fill gives way to a Move into its
 * job, and Undo is just the list without that draft.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KIT_MAP_VERSION,
  backsUp,
  deriveKitMapChanges,
  kitMapMessageVersion,
  parseKitMapDocument,
  parseKitMapDrafts,
  parseKitMapMessage,
  parseKitMapPendingChange,
  parseKitMapScan,
  toSavedEntry,
  type KitMapDocument,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapMessage,
  type KitMapScan,
} from '../src/kit-map.js';

const hash = (n: number): string => `sha256:${n.toString(16).padStart(64, '0')}`;
const [A, B, C, D, E, F, G] = [1, 2, 3, 4, 5, 6, 7].map(hash);
const UNKNOWN = hash(99);

function entry(key: string, overrides: Partial<KitMapEntry> = {}): KitMapEntry {
  return {
    key,
    name: 'House Style',
    description: 'Write copy a stranger will skim.',
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job: 'writing.editing',
    usage: { state: 'used', reason: null },
    ...overrides,
  };
}

// One of each source the folder rules produce, with the optional parts filled
// in somewhere so the round trip covers them.
const SCAN: KitMapScan = {
  entries: [
    entry(A),
    entry(B, { name: 'Better Writing', tools: [{ tool: 'codex', copies: 1 }, { tool: 'opencode', copies: 1 }] }),
    entry(C, {
      name: 'Noslop',
      source: 'plugin',
      from: { kind: 'plugin', name: 'compound-engineering', on: true },
      usage: { state: 'unknown', reason: 'capped' },
      noMerge: { reason: 'plugin' },
    }),
    entry(D, {
      name: 'Code Review',
      source: 'skillet-added',
      job: 'development.code-review',
      skillet: { ref: '@every/code-review', name: 'Code Review' },
      tools: [{ tool: 'claude-code', copies: 2 }],
    }),
    entry(E, {
      name: 'Deploy Notes',
      job: null,
      usage: { state: 'unused', reason: 'no-recent-run' },
      noBackup: { reason: 'secret', file: '.env' },
    }),
    entry(F, { name: 'Docs', source: 'synced', job: 'writing.docs', from: { kind: 'organization', name: 'acme', on: null } }),
    entry(G, { name: 'Refresh Books', source: 'skillet-imported', job: 'business.finance', skillet: { ref: null, name: 'Refresh Books' } }),
  ],
  looked: [
    { tool: 'claude-code', history: 'read' },
    { tool: 'codex', history: 'short' },
    { tool: 'cursor', history: 'none' },
  ],
  unchecked: [
    { reason: 'protected-folder', tools: ['claude-code'] },
    { reason: 'plugin-missing', tools: ['claude-code'], plugin: 'compound-engineering@every' },
  ],
};

const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** A stand-in one-time proof in the registry's shape: 32 to 256 of A-Z, a-z, 0-9, _ and -. */
const PROOF = 'pRoOf_0123456789abcdefghijklmnopqrstuv';

const MESSAGES: KitMapMessage[] = [
  { type: 'scan', v: 1, scan: SCAN },
  { type: 'session', v: 1, session: 'map_4f9c2a7e1b', expiresAt: 1_790_000_000_000, proof: PROOF },
  { type: 'status', v: 1, state: 'saving' },
  { type: 'status', v: 1, state: 'failed', reason: 'locked' },
  { type: 'status', v: 1, state: 'ended' },
  { type: 'status', v: 1, state: 'confirm', handle: 'test-handle' },
  { type: 'confirm', v: 1 },
  { type: 'ready', v: 1 },
  { type: 'drafts', v: 1, drafts: [{ kind: 'move', key: A, job: 'writing.docs' }] },
  { type: 'save', v: 1, drafts: [{ kind: 'remove', key: E }, { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' }] },
  { type: 'proof-request', v: 1, session: 'map_4f9c2a7e1b' },
  { type: 'proof', v: 1, session: 'map_4f9c2a7e1b', proof: PROOF, counts: { backups: 2, removals: 1, fills: 1, merges: 0 } },
];

describe('the scan payload', () => {
  it('passes validation and round-trips unchanged, through JSON and through postMessage cloning', () => {
    assert.deepEqual(parseKitMapScan(roundTrip(SCAN)), SCAN);
    assert.deepEqual(parseKitMapScan(structuredClone(SCAN)), SCAN);
    const message = { type: 'scan', v: KIT_MAP_VERSION, scan: SCAN };
    assert.deepEqual(parseKitMapMessage(roundTrip(message)), message);
  });

  it('accepts an empty scan, the map with every job open', () => {
    const empty: KitMapScan = { entries: [], looked: [], unchecked: [] };
    assert.deepEqual(parseKitMapScan(empty), empty);
  });

  it('says whether this computer is connected, as a plain flag', () => {
    const connected: KitMapScan = { ...SCAN, connected: true };
    assert.deepEqual(parseKitMapScan(roundTrip(connected)), connected);
    assert.deepEqual(parseKitMapScan({ ...SCAN, connected: false }), { ...SCAN, connected: false });
    assert.equal(parseKitMapScan({ ...SCAN, connected: 'yes' }), null);
    assert.equal(parseKitMapScan({ ...SCAN, connected: { handle: 'test-handle' } }), null, 'never the account itself');
  });

  it('rejects an entry carrying a path, in any field', () => {
    const withField = (field: string, value: unknown) => ({ ...SCAN, entries: [{ ...SCAN.entries[0], [field]: value }] });
    for (const field of ['path', 'dir', 'folder', 'root', 'installPath', 'file']) {
      assert.equal(parseKitMapScan(withField(field, '/Users/test-machine/.claude/skills/writing-style')), null, field);
    }
    const pluginWithPath = { ...SCAN.entries[2], from: { kind: 'plugin', name: 'compound-engineering', on: true, installPath: '~/.claude/plugins/x' } };
    assert.equal(parseKitMapScan({ ...SCAN, entries: [pluginWithPath] }), null);
    const folderAsName = { ...SCAN.entries[2], from: { kind: 'plugin', name: 'cache/every/compound-engineering', on: true } };
    assert.equal(parseKitMapScan({ ...SCAN, entries: [folderAsName] }), null);
    const fileAsPath = { ...SCAN.entries[4], noBackup: { reason: 'secret', file: 'scripts/.env' } };
    assert.equal(parseKitMapScan({ ...SCAN, entries: [fileAsPath] }), null);
    // A place it couldn't check is named by reason and tool, never by its path.
    const placeWithPath = { reason: 'protected-folder', tools: ['claude-code'], path: '~/Documents/skills' };
    assert.equal(parseKitMapScan({ ...SCAN, unchecked: [placeWithPath] }), null);
  });

  it('rejects malformed entries', () => {
    const bad = (patch: Record<string, unknown>) => parseKitMapScan({ ...SCAN, entries: [{ ...SCAN.entries[0], ...patch }] });
    assert.equal(bad({ key: 'writing-style' }), null, 'a key is a content hash');
    assert.equal(bad({ source: 'downloaded' }), null, 'an unknown source');
    assert.equal(bad({ job: 'writing.tweets' }), null, 'an unknown job');
    assert.equal(bad({ name: '' }), null, 'a blank name');
    assert.equal(bad({ tools: [{ tool: 'claude-code', copies: 0 }] }), null, 'a copy count below one');
    assert.equal(bad({ usage: { state: 'stale', reason: null } }), null, 'an unknown usage state');
    assert.equal(bad({ source: 'plugin' }), null, 'a plugin skill that names no plugin');
    assert.equal(bad({ from: { kind: 'plugin', name: 'x', on: true } }), null, 'a local skill that names a plugin');
    assert.equal(bad({ skillet: { ref: '@every/code-review', name: 'Code Review' } }), null, 'a local skill with a Skillet page');
    const twice = { ...SCAN, entries: [SCAN.entries[0], SCAN.entries[0]] };
    assert.equal(parseKitMapScan(twice), null, 'one key twice');
  });
});

describe('bridge messages', () => {
  const entries = SCAN.entries;

  it('round-trip every message type, status ended included', () => {
    for (const message of MESSAGES) {
      assert.deepEqual(parseKitMapMessage(roundTrip(message), entries), message, message.type);
    }
  });

  it('reject a message with an unknown version, and report the version it carried', () => {
    for (const message of MESSAGES) {
      for (const v of [2, 0, '1', null]) {
        assert.equal(parseKitMapMessage({ ...message, v }, entries), null, `${message.type} v=${String(v)}`);
      }
      const { v: _v, ...unversioned } = message;
      assert.equal(parseKitMapMessage(unversioned, entries), null, `${message.type} without a version`);
      assert.equal(kitMapMessageVersion({ ...message, v: 2 }), 2);
    }
    assert.equal(kitMapMessageVersion('ready'), null);
  });

  it('reject an unknown message type and unknown fields', () => {
    assert.equal(parseKitMapMessage({ type: 'hello', v: 1 }), null);
    assert.equal(parseKitMapMessage({ type: 'ready', v: 1, from: 'frame' }), null);
    assert.equal(parseKitMapMessage({ type: 'status', v: 1, state: 'thinking' }), null);
  });

  it('carry the one-time proof only in its own shape, and the account handle only with confirm', () => {
    const session = MESSAGES.find((m) => m.type === 'session')!;
    const proof = MESSAGES.find((m) => m.type === 'proof')!;
    for (const message of [session, proof]) {
      const { proof: _proof, ...withoutProof } = message as { proof: string };
      assert.equal(parseKitMapMessage(withoutProof), null, `${message.type} without its proof`);
      assert.equal(parseKitMapMessage({ ...message, proof: 'short' }), null, `${message.type} with a short proof`);
      assert.equal(parseKitMapMessage({ ...message, proof: 'x'.repeat(31) + '!' }), null, `${message.type} with a bad character`);
    }
    assert.equal(parseKitMapMessage({ type: 'status', v: 1, state: 'confirm' }), null, 'confirm without a handle');
    assert.equal(parseKitMapMessage({ type: 'status', v: 1, state: 'saving', handle: 'test-handle' }), null, 'a handle outside confirm');
    assert.equal(parseKitMapMessage({ type: 'status', v: 1, state: 'confirm', handle: 'not a handle' }), null, 'a malformed handle');
    assert.equal(parseKitMapMessage({ type: 'confirm', v: 1, handle: 'test-handle' }), null, 'confirm carries nothing');
  });

  it('reject drafts or a save when there is no scan to check their keys against', () => {
    const drafts = MESSAGES.find((m) => m.type === 'drafts')!;
    const save = MESSAGES.find((m) => m.type === 'save')!;
    assert.equal(parseKitMapMessage(drafts), null);
    assert.equal(parseKitMapMessage(save), null);
  });

  it('reject a proof carrying any skill name', () => {
    const proof = MESSAGES.find((m) => m.type === 'proof')!;
    assert.ok(proof.type === 'proof');
    assert.deepEqual(parseKitMapMessage(proof), proof);
    assert.equal(parseKitMapMessage({ ...proof, names: ['House Style'] }), null);
    assert.equal(parseKitMapMessage({ ...proof, skill: 'House Style' }), null);
    assert.equal(parseKitMapMessage({ ...proof, counts: { ...proof.counts, skills: ['House Style'] } }), null);
    assert.equal(parseKitMapMessage({ ...proof, counts: { ...proof.counts, backups: 'House Style' } }), null);
    assert.equal(parseKitMapMessage({ ...proof, session: 'House Style' }), null);
    assert.equal(parseKitMapMessage({ ...proof, counts: { ...proof.counts, removals: -1 } }), null);
  });
});

describe('drafts', () => {
  const entries = SCAN.entries;

  it('pass when every key is one the scan found', () => {
    const drafts: KitMapDraft[] = [
      { kind: 'merge', job: 'writing.editing', keys: [A, B] },
      { kind: 'remove', key: E },
      { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' },
      { kind: 'move', key: C, job: null },
    ];
    assert.deepEqual(parseKitMapDrafts(roundTrip(drafts), entries), drafts);
  });

  it('are rejected when any of them names an unknown key', () => {
    const ok: KitMapDraft = { kind: 'remove', key: E };
    for (const bad of [
      { kind: 'remove', key: UNKNOWN },
      { kind: 'move', key: UNKNOWN, job: 'writing.docs' },
      { kind: 'merge', job: 'writing.editing', keys: [A, UNKNOWN] },
    ]) {
      assert.equal(parseKitMapDrafts([ok, bad], entries), null, bad.kind);
      assert.equal(parseKitMapMessage({ type: 'drafts', v: 1, drafts: [ok, bad] }, entries), null);
      assert.equal(parseKitMapMessage({ type: 'save', v: 1, drafts: [ok, bad] }, entries), null);
    }
  });

  it('are rejected when malformed', () => {
    const bad = (draft: unknown) => parseKitMapDrafts([draft], entries);
    assert.equal(bad({ kind: 'merge', job: 'writing.editing', keys: [A] }), null, 'a merge of one');
    assert.equal(bad({ kind: 'merge', job: 'writing.editing', keys: [A, A] }), null, 'a key merged twice');
    assert.equal(bad({ kind: 'merge', job: 'writing.tweets', keys: [A, B] }), null, 'an unknown job');
    assert.equal(bad({ kind: 'fill', job: 'writing.emails', ref: 'openclaudia/email-sequence' }), null, 'a ref not in @owner/slug form');
    assert.equal(bad({ kind: 'rename', key: A, name: 'x' }), null, 'an unknown kind');
    assert.equal(bad({ kind: 'remove', key: A, path: '/tmp/x' }), null, 'an unknown field');
    assert.equal(parseKitMapDrafts({ kind: 'remove', key: A }, entries), null, 'not a list');
  });

  it('cannot remove what Skillet only names, or merge what cannot be merged', () => {
    // Plugin and synced skills are never changed: the map names what to turn off.
    assert.equal(parseKitMapDrafts([{ kind: 'remove', key: C }], entries), null, 'plugin');
    assert.equal(parseKitMapDrafts([{ kind: 'remove', key: F }], entries), null, 'synced');
    assert.equal(parseKitMapDrafts([{ kind: 'merge', job: 'writing.editing', keys: [A, C] }], entries), null, 'flagged unable to merge');
    // Moving one is only a map change, so any skill can move.
    assert.ok(parseKitMapDrafts([{ kind: 'move', key: C, job: 'writing.docs' }], entries));
    // Skillet-managed copies leave the kit instead of going to the trash.
    assert.ok(parseKitMapDrafts([{ kind: 'remove', key: D }, { kind: 'remove', key: G }], entries));
  });
});

describe('deriveKitMapChanges', () => {
  const J = 'writing.editing' as const;
  // Four skills in one job, one in Docs, and nothing in Emails.
  const ON_MAP: KitMapEntry[] = [
    entry(A),
    entry(B, { name: 'Better Writing' }),
    entry(C, { name: 'Writing Guidelines' }),
    entry(D, { name: 'Plain Words' }),
    entry(E, { name: 'Doc Coauthoring', job: 'writing.docs' }),
  ];
  const derive = (drafts: KitMapDraft[]) => deriveKitMapChanges(drafts, ON_MAP);

  it('takes keys a later Remove or Move takes out of a merge, and leaves a merge of one out of Save', () => {
    const merge: KitMapDraft = { kind: 'merge', job: J, keys: [A, B, C, D] };
    const one = derive([merge, { kind: 'remove', key: A }]);
    assert.deepEqual(one.drafts[0], { draft: merge, active: true, sources: [B, C, D] });
    assert.deepEqual(one.changes, [{ kind: 'merge', job: J, keys: [B, C, D] }, { kind: 'remove', key: A }]);

    const three = derive([
      merge,
      { kind: 'remove', key: A },
      { kind: 'remove', key: B },
      { kind: 'move', key: C, job: 'writing.docs' },
    ]);
    assert.deepEqual(three.drafts[0], { draft: merge, active: false, reason: 'too-few-sources', sources: [D] });
    assert.deepEqual(three.changes, [
      { kind: 'remove', key: A },
      { kind: 'remove', key: B },
      { kind: 'move', key: C, job: 'writing.docs' },
    ]);
    assert.equal(three.counts.merges, 0);
  });

  it('keeps a key whose later Move leaves it in the merge job', () => {
    const merge: KitMapDraft = { kind: 'merge', job: J, keys: [A, B] };
    const back = derive([merge, { kind: 'move', key: A, job: 'writing.docs' }, { kind: 'move', key: A, job: J }]);
    assert.deepEqual(back.drafts[0], { draft: merge, active: true, sources: [A, B] });
  });

  it('drops a key from a merge once Undo takes back the Move that brought it in', () => {
    const merge: KitMapDraft = { kind: 'merge', job: J, keys: [A, E] };
    const drafts: KitMapDraft[] = [{ kind: 'move', key: E, job: J }, merge];
    assert.deepEqual(derive(drafts).drafts[1], { draft: merge, active: true, sources: [A, E] });
    // E is back in Docs, so the merge is down to one.
    assert.deepEqual(derive(drafts.slice(1)).drafts[0], { draft: merge, active: false, reason: 'too-few-sources', sources: [A] });
  });

  it('leaves a Fill out of Save once a later Move puts a skill in its job', () => {
    const fill: KitMapDraft = { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' };
    const move: KitMapDraft = { kind: 'move', key: A, job: 'writing.emails' };
    const derived = derive([fill, move]);
    assert.deepEqual(derived.drafts[0], { draft: fill, active: false, reason: 'filled-by-move' });
    assert.deepEqual(derived.changes, [move]);
    assert.equal(derived.counts.fills, 0);
    // A skill moved in and back out again leaves the job empty, so the Fill stands.
    assert.equal(derive([fill, move, { kind: 'move', key: A, job: 'writing.docs' }]).drafts[0].active, true);
    // As does one moved in and then removed.
    assert.equal(derive([fill, move, { kind: 'remove', key: A }]).drafts[0].active, true);
  });

  it('leaves a Fill out once its job holds a skill again, as after Undo of the Move that emptied it', () => {
    const fill: KitMapDraft = { kind: 'fill', job: 'writing.docs', ref: '@sentry/doc-coauthoring' };
    const drafts: KitMapDraft[] = [{ kind: 'move', key: E, job: null }, fill];
    assert.deepEqual(derive(drafts).drafts[1], { draft: fill, active: true });
    assert.deepEqual(derive(drafts.slice(1)).drafts[0], { draft: fill, active: false, reason: 'not-empty' });
  });

  it('re-derives on Undo, which drops one draft and keeps the rest', () => {
    const merge: KitMapDraft = { kind: 'merge', job: J, keys: [A, B] };
    const fill: KitMapDraft = { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' };
    const drafts: KitMapDraft[] = [merge, fill, { kind: 'remove', key: A }, { kind: 'move', key: C, job: 'writing.emails' }];
    const before = derive(drafts);
    assert.equal(before.drafts[0].active, false);
    assert.equal(before.drafts[1].active, false);

    const undoRemove = derive(drafts.filter((_, i) => i !== 2));
    assert.deepEqual(undoRemove.drafts[0], { draft: merge, active: true, sources: [A, B] });
    const undoMove = derive(drafts.filter((_, i) => i !== 3));
    assert.deepEqual(undoMove.drafts[1], { draft: fill, active: true });
  });

  it('gives a key to the latest merge that keeps it, and to only that one', () => {
    const first: KitMapDraft = { kind: 'merge', job: J, keys: [A, B] };
    const second: KitMapDraft = { kind: 'merge', job: J, keys: [B, C] };
    const derived = derive([first, second]);
    assert.deepEqual(derived.drafts[0], { draft: first, active: false, reason: 'too-few-sources', sources: [A] });
    assert.deepEqual(derived.changes, [second]);
    // Once the later merge falls below two, the earlier one keeps its keys.
    const fallen = derive([first, second, { kind: 'remove', key: C }]);
    assert.deepEqual(fallen.drafts[0], { draft: first, active: true, sources: [A, B] });
    assert.deepEqual(fallen.drafts[1], { draft: second, active: false, reason: 'too-few-sources', sources: [B] });
    assert.deepEqual(fallen.changes, [first, { kind: 'remove', key: C }]);
  });

  it('sends each Remove once, the last Move of a key, the last Fill of a job, and no Move of a removed key', () => {
    const drafts: KitMapDraft[] = [
      { kind: 'move', key: A, job: 'writing.docs' },
      { kind: 'remove', key: B },
      { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' },
      { kind: 'move', key: A, job: 'writing.long-reads' },
      { kind: 'remove', key: B },
      { kind: 'move', key: B, job: 'writing.docs' },
      { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/cold-email' },
    ];
    const derived = derive(drafts);
    assert.deepEqual(
      derived.drafts.map((d) => [d.active, d.reason]),
      [
        [false, 'moved-again'],
        [true, undefined],
        [false, 'filled-again'],
        [true, undefined],
        [false, 'repeat'],
        [false, 'removed'],
        [true, undefined],
      ],
    );
    assert.deepEqual(derived.changes, [drafts[1], drafts[3], drafts[6]]);
    // Where each skill still on the map ends up.
    assert.deepEqual(
      [...derived.jobs],
      [
        [A, 'writing.long-reads'],
        [C, J],
        [D, J],
        [E, 'writing.docs'],
      ],
    );
  });

  it('derives nothing from no drafts', () => {
    const none = derive([]);
    assert.deepEqual(none.drafts, []);
    assert.deepEqual(none.changes, []);
    assert.deepEqual(none.counts, { backups: 5, removals: 0, fills: 0, merges: 0 });
    assert.equal(none.jobs.size, ON_MAP.length);
  });
});

describe('what Save counts', () => {
  it('backs up local skills only, minus removed ones and ones flagged unable to back up', () => {
    assert.deepEqual(
      SCAN.entries.filter(backsUp).map((e) => e.key),
      [A, B],
    );
    const derived = deriveKitMapChanges(
      [
        { kind: 'merge', job: 'writing.editing', keys: [A, B] },
        { kind: 'remove', key: B },
        { kind: 'remove', key: D },
        { kind: 'fill', job: 'writing.emails', ref: '@openclaudia/email-sequence' },
      ],
      SCAN.entries,
    );
    assert.deepEqual(derived.counts, { backups: 1, removals: 2, fills: 1, merges: 0 });
    // The proof the frame answers with carries exactly these counts.
    const proof = { type: 'proof', v: 1, session: 'map_4f9c2a7e1b', proof: PROOF, counts: derived.counts };
    assert.deepEqual(parseKitMapMessage(proof), proof);
  });
});

describe('the saved map', () => {
  const DOC: KitMapDocument = {
    version: 3,
    entries: SCAN.entries.map(toSavedEntry),
    assignments: { [A]: 'writing.long-reads', [E]: null },
  };

  it('keeps who and where, never usage, tools or flags', () => {
    assert.deepEqual(toSavedEntry(SCAN.entries[2]), {
      key: C,
      name: 'Noslop',
      description: 'Write copy a stranger will skim.',
      source: 'plugin',
      from: { kind: 'plugin', name: 'compound-engineering' },
    });
    assert.deepEqual(toSavedEntry(SCAN.entries[3]), {
      key: D,
      name: 'Code Review',
      description: 'Write copy a stranger will skim.',
      source: 'skillet-added',
      skillet: { ref: '@every/code-review', name: 'Code Review' },
    });
  });

  it('passes validation and round-trips unchanged', () => {
    assert.deepEqual(parseKitMapDocument(roundTrip(DOC)), DOC);
    assert.deepEqual(parseKitMapDocument({ version: 0, entries: [], assignments: {} }), { version: 0, entries: [], assignments: {} });
  });

  it('is rejected when it holds any path field', () => {
    const inEntry = (field: string) => ({ ...DOC, entries: [{ ...DOC.entries[0], [field]: '/Users/test-machine/.claude/skills/writing-style' }, ...DOC.entries.slice(1)] });
    for (const field of ['path', 'dir', 'folder', 'root', 'installPath', 'file']) {
      assert.equal(parseKitMapDocument(inEntry(field)), null, field);
    }
    assert.equal(parseKitMapDocument({ ...DOC, root: '~/.claude/skills' }), null, 'on the document');
    const plugin = DOC.entries[2]!;
    assert.ok(plugin.from);
    const nested = { ...plugin, from: { ...plugin.from, installPath: '~/.claude/plugins/cache/every' } };
    assert.equal(parseKitMapDocument({ ...DOC, entries: [...DOC.entries.slice(0, 2), nested, ...DOC.entries.slice(3)] }), null, 'inside from');
    assert.equal(parseKitMapDocument({ ...DOC, assignments: { [A]: { job: 'writing.docs', path: '/tmp' } } }), null, 'in an assignment');
  });

  it('is rejected when it holds any usage state or reason', () => {
    const scanned = SCAN.entries[4]!;
    const inEntry = (patch: Record<string, unknown>) => ({ ...DOC, entries: [...DOC.entries.slice(0, 4), { ...DOC.entries[4], ...patch }, ...DOC.entries.slice(5)] });
    assert.equal(parseKitMapDocument(inEntry({ usage: scanned.usage })), null, 'usage');
    assert.equal(parseKitMapDocument(inEntry({ state: 'unused' })), null, 'state');
    assert.equal(parseKitMapDocument(inEntry({ reason: 'no-recent-run' })), null, 'reason');
    assert.equal(parseKitMapDocument(inEntry({ noBackup: scanned.noBackup })), null, 'a flag');
    assert.equal(parseKitMapDocument(inEntry({ tools: scanned.tools })), null, 'tools');
    assert.equal(parseKitMapDocument({ ...DOC, usage: { [E]: 'unused' } }), null, 'on the document');
    // The scan entry itself, with its usage, is never a saved entry.
    assert.equal(parseKitMapDocument({ ...DOC, entries: SCAN.entries }), null, 'a scan entry as saved');
  });

  it('is rejected when malformed', () => {
    assert.equal(parseKitMapDocument({ ...DOC, version: -1 }), null, 'a negative version');
    assert.equal(parseKitMapDocument({ ...DOC, version: 1.5 }), null, 'a fractional version');
    assert.equal(parseKitMapDocument({ ...DOC, assignments: { [UNKNOWN]: 'writing.docs' } }), null, 'an assignment to no entry');
    assert.equal(parseKitMapDocument({ ...DOC, assignments: { [A]: 'writing.tweets' } }), null, 'an unknown job');
    const { assignments: _a, ...noAssignments } = DOC;
    assert.equal(parseKitMapDocument(noAssignments), null, 'no assignments');
  });
});

describe('pending changes', () => {
  it('pass for remove, merge and replace, with or without a target device', () => {
    const changes = [
      { id: 'b6d0a3f2-0c1e-4f57-9a8e-2f5d6c7b8a90', kind: 'remove', device: 'dev-1', version: 1, key: A },
      { id: 'pc-2', kind: 'merge', device: null, version: 0, job: 'writing.editing', keys: [A, B] },
      { id: 'pc-3', kind: 'replace', device: 'dev-1', version: 2, merged: E, keys: [A, B] },
    ];
    for (const change of changes) {
      assert.deepEqual(parseKitMapPendingChange(roundTrip(change)), change, change.kind);
    }
  });

  it('pass an unknown kind as unknown, so an older client can skip it', () => {
    const later = { id: 'pc-9', kind: 'rename', device: 'dev-1', version: 4, key: A, name: 'Writing' };
    assert.deepEqual(parseKitMapPendingChange(later), { id: 'pc-9', kind: 'unknown', rawKind: 'rename', device: 'dev-1', version: 4 });
    // A known kind this client can't fully read is skipped the same way, never half-applied.
    const grown = { id: 'pc-10', kind: 'remove', device: null, version: 1, key: A, keepBackup: false };
    assert.deepEqual(parseKitMapPendingChange(grown), { id: 'pc-10', kind: 'unknown', rawKind: 'remove', device: null, version: 1 });
  });

  it('are rejected when the record itself is malformed', () => {
    const base = { id: 'pc-1', kind: 'remove', device: 'dev-1', version: 1, key: A };
    assert.equal(parseKitMapPendingChange({ ...base, id: '' }), null);
    assert.equal(parseKitMapPendingChange({ ...base, device: 7 }), null);
    assert.equal(parseKitMapPendingChange({ ...base, version: '1' }), null);
    assert.equal(parseKitMapPendingChange({ ...base, kind: 3 }), null);
    assert.equal(parseKitMapPendingChange('remove'), null);
  });
});

describe('the module', () => {
  it('imports nothing from node:, directly or through what it imports', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const [, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
        assert.ok(spec.startsWith('./'), `${file} imports ${spec}`);
        visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
      }
      assert.ok(!/['"]node:/.test(source), `${file} names a node: module`);
    };
    visit(resolve(here, '../src/kit-map.ts'));
    assert.ok(seen.size >= 2, 'follows its own imports');
  });
});
