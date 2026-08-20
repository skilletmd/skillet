import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DecodedBundle } from '@skillet/protocol';
import { runCapabilityScan } from './collector.js';
import type { Capability, CapabilityDetector } from './types.js';

const enc = new TextEncoder();

function bundle(files: Record<string, string>): DecodedBundle {
  return new Map(Object.entries(files).map(([path, text]) => [path, enc.encode(text)]));
}

/** A detector that fires `capability` on every line containing `needle`. */
function lineDetector(capability: Capability, needle: string): CapabilityDetector {
  return (_file, contents) => {
    const out: Array<{ capability: Capability; lineStart: number; lineEnd: number }> = [];
    const lines = contents.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) {
        out.push({ capability, lineStart: i + 1, lineEnd: i + 1 });
      }
    }
    return out;
  };
}

describe('runCapabilityScan', () => {
  it('returns an empty report for an empty bundle', () => {
    assert.deepEqual(runCapabilityScan(bundle({}), []), {
      capabilities: [],
      analysis: 'full',
      blindSpots: [],
    });
  });

  it('returns an empty report when no detectors are registered (U1 default)', () => {
    const b = bundle({ 'run.sh': 'curl https://x\n' });
    assert.deepEqual(runCapabilityScan(b), {
      capabilities: [],
      analysis: 'full',
      blindSpots: [],
    });
  });

  it('merges the same capability across two files into one entry with two evidence locations', () => {
    const b = bundle({
      'a.sh': 'fetch here\n',
      'b.py': 'also fetch here\n',
    });
    const report = runCapabilityScan(b, [lineDetector('network', 'fetch')]);
    assert.equal(report.capabilities.length, 1);
    const entry = report.capabilities[0];
    assert.equal(entry.capability, 'network');
    assert.equal(entry.risky, false);
    assert.equal(entry.evidence.length, 2);
    assert.deepEqual(
      entry.evidence.map((e) => e.file),
      ['a.sh', 'b.py'],
    );
  });

  it('tags evidence source as instructions for SKILL.md / .md and code otherwise', () => {
    const b = bundle({
      'SKILL.md': 'run shell\n',
      'docs/guide.md': 'run shell\n',
      'script.py': 'run shell\n',
    });
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'run shell')]);
    assert.equal(report.capabilities.length, 1);
    const bySource = Object.fromEntries(
      report.capabilities[0].evidence.map((e) => [e.file, e.source]),
    );
    assert.equal(bySource['SKILL.md'], 'instructions');
    assert.equal(bySource['docs/guide.md'], 'instructions');
    assert.equal(bySource['script.py'], 'code');
  });

  it('dedups identical (file,line,capability) hits to a single evidence item', () => {
    // Two detectors both fire the same capability on the same line of the same file.
    const b = bundle({ 'x.sh': 'fetch fetch\n' });
    const report = runCapabilityScan(b, [
      lineDetector('network', 'fetch'),
      lineDetector('network', 'fetch'),
    ]);
    assert.equal(report.capabilities.length, 1);
    assert.equal(report.capabilities[0].evidence.length, 1);
  });

  it('U2 seam: a capability whose evidence overlaps a threat finding is marked risky', () => {
    const b = bundle({ 'x.sh': 'shred disk\n' });
    const report = runCapabilityScan(
      b,
      [lineDetector('deletes-files', 'shred')],
      [{ file: 'x.sh', lineStart: 1, lineEnd: 1 }],
    );
    assert.equal(report.capabilities.length, 1);
    assert.equal(report.capabilities[0].capability, 'deletes-files');
    assert.equal(report.capabilities[0].risky, true);
  });

  // FIX6: chips come out in the single canonical order, not localeCompare.
  it('emits capabilities in the canonical CAPABILITY_ORDER (not alphabetical)', () => {
    const b = bundle({ 's.js': 'one\n' });
    // Fire several capabilities on the same file; the collector must order them
    // by CAPABILITY_ORDER (runs-shell, network, writes-files, deletes-files, …),
    // which differs from the alphabetical order localeCompare would give.
    const report = runCapabilityScan(b, [
      lineDetector('executes-generated', 'one'),
      lineDetector('network', 'one'),
      lineDetector('runs-shell', 'one'),
      lineDetector('deletes-files', 'one'),
    ]);
    assert.deepEqual(
      report.capabilities.map((c) => c.capability),
      ['runs-shell', 'network', 'deletes-files', 'executes-generated'],
    );
  });
});

describe('runCapabilityScan — risky-join line boundary (FIX test)', () => {
  // A finding band [2,2] and evidence band [2,2] touch → risky; the join is an
  // inclusive overlap, so the exact boundary line must count.
  it('marks risky when finding lineEnd == evidence lineStart (boundary touch)', () => {
    const b = bundle({ 'x.py': 'a\nb\n' });
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'b')], [
      { file: 'x.py', lineStart: 2, lineEnd: 2 },
    ]);
    assert.equal(report.capabilities[0].risky, true);
  });

  it('does NOT mark risky when the finding is on an adjacent (non-overlapping) line', () => {
    const b = bundle({ 'x.py': 'a\nb\n' }); // detector fires on line 2 ("b")
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'b')], [
      { file: 'x.py', lineStart: 1, lineEnd: 1 }, // finding on line 1, evidence on 2
    ]);
    assert.equal(report.capabilities[0].risky, false);
  });

  it('does NOT mark risky when the finding is in a DIFFERENT file', () => {
    const b = bundle({ 'x.py': 'b\n', 'y.py': 'b\n' });
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'b')], [
      { file: 'other.py', lineStart: 1, lineEnd: 1 },
    ]);
    assert.ok(report.capabilities.every((c) => c.risky === false));
  });
});

describe('runCapabilityScan — partial analysis', () => {
  it('a covered-language file with no hits stays full', () => {
    const b = bundle({ 'ok.py': 'x = 1\n' });
    const report = runCapabilityScan(b, []);
    assert.equal(report.analysis, 'full');
  });

  it('an un-inspected language (.rb) with no detector marks partial', () => {
    const b = bundle({ 'setup.rb': 'system("ls")\n' });
    const report = runCapabilityScan(b, []);
    assert.deepEqual(report.capabilities, []);
    assert.equal(report.analysis, 'partial');
  });

  it('an extensionless shebang script (un-inspected) marks partial', () => {
    const b = bundle({ 'hook': '#!/usr/bin/env ruby\nputs 1\n' });
    const report = runCapabilityScan(b, []);
    assert.equal(report.analysis, 'partial');
  });

  it('a binary script-shaped file (skipped by isTextFile) marks partial', () => {
    const b = bundle({ 'go.ksh': '#!/bin/sh\n' });
    // Inject a NUL so isTextFile skips it as binary.
    b.set('go.ksh', new Uint8Array([0x23, 0x21, 0x2f, 0x73, 0x68, 0x0a, 0x00, 0x00, 0x62]));
    const report = runCapabilityScan(b, []);
    assert.equal(report.analysis, 'partial');
  });

  it('skips an oversized text file and marks partial (per-file cap)', () => {
    const big = 'a'.repeat(1024 * 1024 + 1); // just over 1 MiB
    const b = bundle({ 'huge.py': big });
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'a')]);
    // Detection was skipped → no capability, and the report is flagged partial.
    assert.deepEqual(report.capabilities, []);
    assert.equal(report.analysis, 'partial');
  });
});

describe('runCapabilityScan — markdown family (.mdc/.markdown) is scanned, not a blind spot', () => {
  it('a .mdc / .markdown instruction file is full, not partial, and not a blind spot', () => {
    const b = bundle({ 'rules/workers.mdc': 'description: x\n', 'notes.markdown': '# hi\n' });
    const report = runCapabilityScan(b, []);
    assert.equal(report.analysis, 'full');
    assert.deepEqual(report.blindSpots, []);
  });

  it('a hit in a .mdc file is tagged as instruction (prose) evidence, not code', () => {
    const b = bundle({ 'rules/workers.mdc': 'run a shell here\n' });
    const report = runCapabilityScan(b, [lineDetector('runs-shell', 'shell')]);
    const ev = report.capabilities.find((c) => c.capability === 'runs-shell')?.evidence ?? [];
    assert.ok(ev.length > 0);
    assert.equal(ev[0].source, 'instructions');
  });
});

describe('runCapabilityScan — blindSpots (the un-inspected paths behind partial)', () => {
  it('lists an unsupported-language file', () => {
    const b = bundle({ 'setup.rb': 'system("ls")\n' });
    assert.deepEqual(runCapabilityScan(b, []).blindSpots, ['setup.rb']);
  });

  it('lists a binary script-shaped file', () => {
    const b = bundle({ 'go.ksh': '' });
    b.set('go.ksh', new Uint8Array([0x23, 0x21, 0x2f, 0x73, 0x68, 0x0a, 0x00, 0x00, 0x62]));
    assert.deepEqual(runCapabilityScan(b, []).blindSpots, ['go.ksh']);
  });

  it('lists an oversized file', () => {
    const b = bundle({ 'huge.py': 'a'.repeat(1024 * 1024 + 1) });
    assert.deepEqual(runCapabilityScan(b, [lineDetector('runs-shell', 'a')]).blindSpots, [
      'huge.py',
    ]);
  });

  it('does NOT list an inert binary (.png) — matches the partial exemption', () => {
    const b = bundle({ 'logo.png': '' });
    b.set('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    assert.deepEqual(runCapabilityScan(b, []).blindSpots, []);
  });

  it('ignores ephemeral .skillet-backup paths', () => {
    const b = bundle({ 'SKILL.md': '# x\n', 'SKILL.md.skillet-backup': '# old\n' });
    assert.deepEqual(runCapabilityScan(b, []).blindSpots, []);
  });

  it('is empty for a fully-inspected bundle', () => {
    const b = bundle({ 'ok.py': 'x = 1\n' });
    assert.deepEqual(runCapabilityScan(b, []).blindSpots, []);
  });

  it('is deduped + sorted across multiple blind spots', () => {
    const b = bundle({ 'z.rb': 'puts 1\n', 'a.tcl': 'exec foo\n' });
    const report = runCapabilityScan(b, []);
    assert.deepEqual(report.blindSpots, ['a.tcl', 'z.rb']);
    assert.equal(report.analysis, 'partial');
  });
});

describe('runCapabilityScan — inverted partial allowlist', () => {
  it('an un-inspected language OUTSIDE the old denylist (.tcl) marks partial', () => {
    // .tcl was never in the old SCRIPT_EXT_RE → it used to read as a false inert.
    const b = bundle({ 'install.tcl': 'exec apt-get install foo\n' });
    assert.equal(runCapabilityScan(b, []).analysis, 'partial');
  });

  it('an extensionless, shebang-less script marks partial', () => {
    const b = bundle({ 'bin/runhook': 'system("ls")\n' });
    assert.equal(runCapabilityScan(b, []).analysis, 'partial');
  });

  it('a .mts file is covered (full) when a detector inspects it', () => {
    // FIX2 also adds .mts/.cts to the JS detector; a covered file stays full.
    const b = bundle({ 'x.mts': 'const a = 1\n' });
    assert.equal(runCapabilityScan(b, []).analysis, 'full');
  });

  it('clearly-inert data/doc/media files stay full', () => {
    for (const file of ['data.json', 'config.yaml', 'notes.txt', 'logo.svg', 'icon.png', 'deps.lock', 'LICENSE', 'README']) {
      const b = bundle({ [file]: 'arbitrary inert content\n' });
      assert.equal(runCapabilityScan(b, []).analysis, 'full', `${file} should stay full`);
    }
  });

  it('a binary file with an inert shape (.png) does NOT mark partial', () => {
    const b = bundle({ 'logo.png': 'x' });
    b.set('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    assert.equal(runCapabilityScan(b, []).analysis, 'full');
  });

  it('a binary file with a non-inert shape marks partial', () => {
    const b = bundle({ 'bin/tool': 'x' });
    b.set('bin/tool', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02])); // ELF-ish
    assert.equal(runCapabilityScan(b, []).analysis, 'partial');
  });
});
