// Obfuscation markers: long base64 blobs, homoglyphs, zero-width chars,
// eval-of-string. Confidence reflects how much benign content looks similar:
// homoglyphs in scripts are near-zero false positive, base64 in markdown
// fences is normal (data blocks), eval-of-string is high signal.

import type { Detector, Finding } from '../../types.js';
import { runPattern, lineNumber, snippetAround } from '../util.js';
import { isMarkdownFile } from '../../file-classes.js';

const B64 = /[A-Za-z0-9+/]{200,}={0,2}/g;

// Real base64 spreads across the 64 symbols fairly evenly; a long run dominated
// by one repeated character is filler or ASCII art (e.g. a 2 MB block of `x`),
// not encoded data. Reject those so they don't read as obfuscation.
//
// It must also USE the base64 alphabet's full range: base64 of binary data over
// 200+ chars almost always carries lowercase AND digits. A long uppercase-only
// run is a biological sequence (protein single-letter codes) or SMILES-adjacent
// data, not encoded bytes — require both classes so those don't read as base64.
function looksEncoded(run: string): boolean {
  if (!/[a-z]/.test(run) || !/[0-9]/.test(run)) return false;
  const counts = new Map<string, number>();
  for (const ch of run) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  return max / run.length <= 0.4;
}

// Lockfile-shaped paths we never flag base64 on: package manager + Skillet lock.
const LOCKFILE_RE = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|skillet\.lock|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$/i;

function inDataFence(contents: string, offset: number): boolean {
  // Walk backward to the most recent ``` fence; accept the blob as "data"
  // when that fence has an `enc=base64` / `data` / `bin` label.
  const cursor = contents.lastIndexOf('```', offset);
  if (cursor === -1) return false;
  const lineEnd = contents.indexOf('\n', cursor);
  const fence = contents
    .slice(cursor + 3, lineEnd === -1 ? contents.length : lineEnd)
    .trim()
    .toLowerCase();
  // Confirm we're INSIDE this fence (no closing ``` between cursor and offset).
  const close = contents.indexOf('```', cursor + 3);
  if (close !== -1 && close < offset) return false;
  return /^(?:data|base64|b64|bin|binary|raw|enc(?:oding)?=base64)$/.test(fence);
}

// Bidi-override codepoints (U+202A-U+202E, U+2066-U+2069): the Trojan-Source
// attack — reorder source so what a human reads differs from what runs. No
// benign use in a skill, so HIGH anywhere.
const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;

// Zero-width codepoints used as HIDDEN TEXT: a run of them wedged BETWEEN two
// ASCII word characters is the smuggle-instructions-inside-a-word shape. Gated
// this way so the legitimate uses stay clean — a ZWJ (U+200D) inside an emoji
// grapheme like "👨‍👧" sits between pictographs (non-ASCII), and a stray word
// joiner after punctuation has no ASCII on its left — neither matches.
const HIDDEN_ZERO_WIDTH_RE = /[A-Za-z0-9][​-‍⁠-⁤﻿]+[A-Za-z0-9]/g;

// Cyrillic + Greek/Coptic letters inside identifier-shaped contexts. Cheap and
// catches the common scripted swap; sophisticated homoglyph attacks need a
// full Unicode confusables map (future work).
const HOMOGLYPH_RE =
  /[A-Za-z_$][A-Za-z0-9_$]{0,200}[Ѐ-ӿͰ-Ͽ][A-Za-z0-9_$Ѐ-ӿͰ-Ͽ]{0,200}/g;

/** Homoglyph regex is line-scoped — megabyte single-line payloads are a DoS vector. */
const MAX_HOMOGLYPH_LINE_LEN = 4096;

function homoglyphFindings(filePath: string, contents: string): Finding[] {
  const out: Finding[] = [];
  // Markdown/doc prose legitimately mixes Latin with Greek/Cyrillic letters —
  // math (exp(-Xβ)), linguistics, physics — which is NOT the identifier-swap
  // attack this catches (a Cyrillic homoglyph hidden in a script identifier).
  // Downgrade to medium in docs (flag, not block), mirroring the base64-in-
  // markdown downgrade above; scripts/source still fire high.
  const confidence = isMarkdownFile(filePath) ? 'medium' : 'high';
  let lineNum = 1;
  let searchFrom = 0;
  while (searchFrom <= contents.length) {
    const lineEnd = contents.indexOf('\n', searchFrom);
    const end = lineEnd === -1 ? contents.length : lineEnd;
    const line = contents.slice(searchFrom, end);
    if (line.length > 0 && line.length <= MAX_HOMOGLYPH_LINE_LEN) {
      for (const f of runPattern(filePath, line, {
        category: 'obfuscation',
        detector: 'homoglyph-identifier',
        confidence,
        pattern: HOMOGLYPH_RE,
      })) {
        out.push({ ...f, lineStart: lineNum, lineEnd: lineNum });
      }
    }
    if (lineEnd === -1) break;
    searchFrom = lineEnd + 1;
    lineNum++;
  }
  return out;
}

export const obfuscationDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];

  if (!LOCKFILE_RE.test(filePath)) {
    let m: RegExpExecArray | null;
    const re = new RegExp(B64.source, B64.flags);
    while ((m = re.exec(contents)) !== null) {
      const offset = m.index;
      const matched = m[0];
      if (!looksEncoded(matched)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      // Markdown family (incl. .mdc/.mdx) gets the documented-payload downgrade,
      // via the central taxonomy — not just literal `.md`.
      const inFence = isMarkdownFile(filePath) && inDataFence(contents, offset);
      out.push({
        category: 'obfuscation',
        // Data fences in markdown are documented payload: medium signal.
        // Free-floating long base64 in source/script is high signal.
        confidence: inFence ? 'medium' : matched.length > 1000 ? 'high' : 'medium',
        file: filePath,
        lineStart: lineNumber(contents, offset),
        lineEnd: lineNumber(contents, offset + matched.length),
        snippet: snippetAround(contents, offset, Math.min(matched.length, 32)),
        why: inFence ? 'obfuscation:base64-in-data-fence' : 'obfuscation:long-base64',
      });
      if (m.index === re.lastIndex) re.lastIndex++;
      if (out.length > 12) break; // Cap per-file output.
    }
  }

  out.push(
    ...runPattern(filePath, contents, {
      category: 'obfuscation',
      detector: 'bidi-override',
      confidence: 'high',
      pattern: BIDI_OVERRIDE_RE,
    }),
  );

  out.push(
    ...runPattern(filePath, contents, {
      category: 'obfuscation',
      detector: 'zero-width-char',
      confidence: 'high',
      pattern: HIDDEN_ZERO_WIDTH_RE,
    }),
  );

  out.push(...homoglyphFindings(filePath, contents));

  out.push(
    ...runPattern(filePath, contents, {
      category: 'obfuscation',
      detector: 'eval-of-string-payload',
      confidence: 'high',
      // eval/Function(... long base64-ish string ...). We require >40 chars to
      // exclude `eval(x)` and similar legitimate-but-rare uses.
      pattern:
        /\b(?:eval|Function|exec|execSync|spawnSync)\s*\(\s*["'`][A-Za-z0-9+/=]{40,}["'`]/g,
    }),
  );

  return out;
};
