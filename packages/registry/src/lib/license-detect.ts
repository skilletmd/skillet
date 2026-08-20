// Per-skill license detection for the mirror path.
//
// A repo can license at the root, per skill folder, or not at all (audit of 582
// real skill repos: ~69% root, ~10% subfolder-only, ~21% none). The mirror gate
// must resolve a skill's EFFECTIVE license from its own folder → ancestors → repo
// root, and NEVER inherit a sibling's license (an unlicensed skill in an
// otherwise-licensed repo stays unlicensed). Pure functions only — callers own any
// GitHub fetch; this module never touches the network.

/**
 * SPDX ids we treat as permissive enough to redistribute a mirror under. Single
 * source of truth (mirror-screen imports this). Anything outside → not permissive.
 */
export const PERMISSIVE_SPDX = new Set([
  '0BSD',
  'APACHE-2.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'BSD-3-CLAUSE-CLEAR',
  'BLUEOAK-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'UNLICENSE',
  'ZLIB',
]);

export function isPermissiveSpdx(spdx: string | null | undefined): boolean {
  if (!spdx) return false;
  const up = spdx.toUpperCase();
  if (up === 'NOASSERTION') return false;
  return PERMISSIVE_SPDX.has(up);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// Directory segments whose contents are dependency/bundled licenses, not the
// skill's own license (audit noise: `licenses/foo.md`, `third_party/x/BUILD.gn`).
const EXCLUDED_DIR_SEGMENTS = new Set([
  'licenses',
  'third_party',
  'third-party',
  'thirdparty',
  'node_modules',
  'vendor',
]);

// A real license basename: LICENSE/LICENCE/COPYING/UNLICENSE, an optional
// `-SUFFIX` (dual-license: LICENSE-MIT, LICENSE-APACHE), and an optional TEXT
// extension. Underscore-descriptive names (license_checker.py,
// license_compatibility_matrix.md) and code/data extensions are excluded because
// the suffix group forbids `_` and the extension group is a fixed text allowlist.
// `LICENSEZone.Identifier` (a Windows ADS artifact) fails both optional groups.
const LICENSE_BASENAME = /^(licen[sc]e|copying|unlicense)(-[a-z0-9.+-]*)?(\.(txt|md|markdown|rst|html))?$/i;

/** True when `path`'s basename is a license file and it is not under a
 *  dependency/bundle dir. Operates on the full repo-relative path. */
export function isLicenseFile(path: string): boolean {
  const dir = dirname(path).toLowerCase();
  if (dir.split('/').some((seg) => EXCLUDED_DIR_SEGMENTS.has(seg))) return false;
  return LICENSE_BASENAME.test(basename(path));
}

/** Own dir, then each ancestor, then repo root (''). Used to resolve precedence
 *  without ever considering a sibling directory. */
export function licenseSearchDirs(skillDir: string): string[] {
  if (!skillDir) return [''];
  const parts = skillDir.split('/');
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join('/'));
  out.push('');
  return out;
}

/**
 * The license file that governs `skillDir`: the first license found walking own
 * dir → ancestors → root. Returns null when a license exists only in a sibling or
 * unrelated dir (never inherited). `allPaths` is the repo's blob path list.
 */
export function effectiveLicensePath(skillDir: string, allPaths: string[]): string | null {
  const licenses = allPaths.filter(isLicenseFile);
  if (licenses.length === 0) return null;
  for (const dir of licenseSearchDirs(skillDir)) {
    const hit = licenses.find((p) => dirname(p) === dir);
    if (hit) return hit;
  }
  return null;
}

/** SPDX hint from a dual-license filename suffix (LICENSE-MIT → MIT). */
const FILENAME_SPDX: Record<string, string> = {
  mit: 'MIT',
  apache: 'Apache-2.0',
  'apache-2.0': 'Apache-2.0',
  bsd: 'BSD-3-Clause',
  isc: 'ISC',
  mpl: 'MPL-2.0',
  gpl: 'GPL-3.0-only',
  agpl: 'AGPL-3.0-only',
  lgpl: 'LGPL-3.0-only',
  unlicense: 'Unlicense',
  zlib: 'Zlib',
};

function spdxFromFilename(path: string): string | null {
  const base = basename(path).toLowerCase();
  if (/^unlicense/.test(base)) return 'Unlicense';
  const m = base.match(/^licen[sc]e-([a-z0-9.+]+)/);
  if (m && FILENAME_SPDX[m[1]!]) return FILENAME_SPDX[m[1]!]!;
  return null;
}

/**
 * Best-effort SPDX from license TEXT. Needed because a subfolder LICENSE.txt has
 * no repo-level SPDX and no filename hint — the only way to know it's Apache is to
 * read it. Copyleft ids are returned too (so the caller rejects them as
 * non-permissive), and AGPL/LGPL are checked before GPL. Returns null on no match.
 */
export function detectSpdxFromText(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const has = (s: string) => t.toLowerCase().includes(s.toLowerCase());
  // Copyleft first (most specific variants before GPL).
  if (has('GNU AFFERO GENERAL PUBLIC LICENSE')) return 'AGPL-3.0-only';
  if (has('GNU LESSER GENERAL PUBLIC LICENSE')) return 'LGPL-3.0-only';
  if (has('GNU GENERAL PUBLIC LICENSE')) return 'GPL-3.0-only';
  if (has('Mozilla Public License') && has('2.0')) return 'MPL-2.0';
  if (has('Apache License') && has('Version 2.0')) return 'Apache-2.0';
  if (has('This is free and unencumbered software released into the public domain')) return 'Unlicense';
  if (has('CC0 1.0') || (has('Creative Commons') && has('CC0'))) return 'CC0-1.0';
  // CC-BY-4.0 (permissive) — but not the non-permissive CC variants (NC/SA/ND).
  if (
    has('Creative Commons Attribution 4.0') &&
    !has('NonCommercial') &&
    !has('ShareAlike') &&
    !has('NoDerivatives')
  )
    return 'CC-BY-4.0';
  // MIT canonical grant clause (also disambiguates from BSD/ISC below).
  if (has('Permission is hereby granted, free of charge')) return 'MIT';
  // ISC.
  if (has('Permission to use, copy, modify, and/or distribute this software')) return 'ISC';
  // BSD family: 3-clause carries the "Neither the name" endorsement clause.
  if (has('Redistribution and use in source and binary forms')) {
    return has('Neither the name') ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  return null;
}

/**
 * Resolve an SPDX for a located license, given whatever the caller has: the file
 * content (preferred — works for subfolder licenses), a filename hint, and the
 * GitHub repo-root SPDX (valid only for a root license). Returns null when
 * undetermined — callers must treat null as non-permissive (do not guess).
 */
export function resolveSpdx(opts: {
  licensePath: string;
  content?: string | null;
  repoRootSpdx?: string | null;
}): string | null {
  const { licensePath, content, repoRootSpdx } = opts;
  if (content) {
    const fromText = detectSpdxFromText(content);
    if (fromText) return fromText;
  }
  const fromName = spdxFromFilename(licensePath);
  if (fromName) return fromName;
  if (dirname(licensePath) === '' && repoRootSpdx && repoRootSpdx.toUpperCase() !== 'NOASSERTION') {
    return repoRootSpdx;
  }
  return null;
}
