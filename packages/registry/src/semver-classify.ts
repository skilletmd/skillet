// Pure semver classification for skill publishes. The publish route feeds it
// the file maps and SKILL.md texts it already has — no DB access in here.
import { descriptionSpanInSkillMd } from './skill-frontmatter.js';

export type BumpKind = 'major' | 'minor' | 'patch';

/** A stored version label. Ordinal-backfilled rows pass (ordinal, 0, 0). */
export interface VersionLabel {
  major: number;
  minor: number;
  patch: number;
}

/** Wire string for a stored label: `"major.minor.patch"`. */
export function formatVersionLabel(label: VersionLabel): string {
  return `${label.major}.${label.minor}.${label.patch}`;
}

/** Version file listing: path → blob hash. */
export type VersionFileMap = ReadonlyMap<string, string>;

const SKILL_MD = 'SKILL.md';

/** The SKILL.md text with the description's full line span removed. */
function withoutDescriptionSpan(text: string): string {
  const span = descriptionSpanInSkillMd(text);
  if (!span) return text;
  const lines = text.split('\n');
  lines.splice(span.start, span.end - span.start + 1);
  return lines.join('\n');
}

/**
 * Classify a publish diff against the base version (the registry's latest
 * row — the caller supplies its file map). Precedence, highest wins:
 *
 *   1. any path added or removed          → major
 *   2. any non-SKILL.md blob change       → minor
 *   3. SKILL.md-only blob change          → patch iff the two texts are
 *      identical after removing the description's full line span, else minor
 *
 * A SKILL.md text the caller could not read (missing blob) is passed as null
 * and classified minor — never patch on unverifiable content.
 */
export function classifyPublishDiff(
  baseFiles: VersionFileMap,
  nextFiles: VersionFileMap,
  baseSkillMd: string | null,
  nextSkillMd: string | null,
): BumpKind {
  const fileKind = classifyFileMaps(baseFiles, nextFiles);
  if (fileKind !== 'skillmd-only') return fileKind;
  if (baseSkillMd === null || nextSkillMd === null) return 'minor';
  return withoutDescriptionSpan(baseSkillMd) === withoutDescriptionSpan(nextSkillMd)
    ? 'patch'
    : 'minor';
}

/**
 * The file-map half of `classifyPublishDiff`. Returns `'skillmd-only'` when
 * SKILL.md is the only changed blob — the one case that needs both SKILL.md
 * texts — so callers can defer fetching the base text until it matters.
 */
export function classifyFileMaps(
  baseFiles: VersionFileMap,
  nextFiles: VersionFileMap,
): BumpKind | 'skillmd-only' {
  for (const path of baseFiles.keys()) {
    if (!nextFiles.has(path)) return 'major';
  }
  for (const path of nextFiles.keys()) {
    if (!baseFiles.has(path)) return 'major';
  }
  let skillMdChanged = false;
  for (const [path, blob] of nextFiles) {
    if (baseFiles.get(path) === blob) continue;
    if (path !== SKILL_MD) return 'minor';
    skillMdChanged = true;
  }
  return skillMdChanged ? 'skillmd-only' : 'patch';
}

/**
 * Next version label for a publish. `maxLabel` is the skill's maximum stored
 * (major, minor, patch) across ALL version rows including yanked — not the
 * base row's label — so labels stay strictly monotonic and unique across
 * yanks. A skill with no version rows at all gets 1.0.0.
 */
export function nextVersionLabel(kind: BumpKind, maxLabel: VersionLabel | null): VersionLabel {
  if (!maxLabel) return { major: 1, minor: 0, patch: 0 };
  switch (kind) {
    case 'major':
      return { major: maxLabel.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: maxLabel.major, minor: maxLabel.minor + 1, patch: 0 };
    case 'patch':
      return { major: maxLabel.major, minor: maxLabel.minor, patch: maxLabel.patch + 1 };
  }
}
