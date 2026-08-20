import type { KitSkillGroup, SkillEntry } from '@skillet/core';
import { BUNDLED_ROUTE_SLUG } from '@skillet/core';
import { bold, cyan, dim, padEndVisible, yellow } from './cli-colors.js';
import { formatTokens } from './format-tokens.js';
import { renderError } from './render-error.js';

// Width of the token stat cell (`~1.3K`, `~47K`), so a trailing status message
// clears the stat by the same gap on every row that carries one.
const TOKEN_COL_WIDTH = 6;

function formatSkillRow(
  skill: SkillEntry,
  slugWidth: number,
  skipReason?: string,
  kitAuthor?: string | null,
): string {
  // Slug and version only: descriptions and hashes are detail surfaces
  // (--json, the web, doctor), and a scannable list beats a complete one.
  // Inside a kit, a slug's author prefix DIMS when it matches the kit's
  // author (context already says it) and stays bright when it differs —
  // the prefix becomes a trust signal that pops exactly when it matters.
  const sameAuthorPrefix = kitAuthor ? `@${kitAuthor}/` : null;
  const slugCol =
    sameAuthorPrefix && skill.slug.startsWith(sameAuthorPrefix)
      ? padEndVisible(
          dim(sameAuthorPrefix) + cyan(skill.slug.slice(sameAuthorPrefix.length)),
          slugWidth,
        )
      : padEndVisible(cyan(skill.slug), slugWidth);
  const ver = dim(`v${skill.versionLabel ?? skill.version}`);
  // Context-weight stat sits directly after the version and before any status
  // suffix (skipped: …, waiting for your OK), so status always trails the stat.
  // A fixed-width DIM cell only when the registry carried a real count; a
  // 0/absent value renders nothing so no `~NaN` or stray gap appears.
  const tokens =
    typeof skill.tokenCount === 'number' && skill.tokenCount > 0
      ? `  ${padEndVisible(dim(formatTokens(skill.tokenCount)), TOKEN_COL_WIDTH)}`
      : '';
  const skip = skipReason ? `  ${dim(`skipped: ${renderError(skipReason).line}`)}` : '';
  return `  ${slugCol}  ${ver}${tokens}${skip}`;
}

const DEFAULT_SYNC_HEADER = 'Kits on this device';

/** Grouped kit/skill plan for `skillet sync` and `--dry-run` (kit groups only). */
export function renderSyncKitPlan(
  groups: KitSkillGroup[],
  opts?: {
    skipReasons?: Map<string, string>;
    header?: string;
    offline?: boolean;
  },
): string {
  const kitGroups = groups.filter((g): g is KitSkillGroup & { kitRef: string } => g.kitRef !== null);
  if (kitGroups.length === 0) {
    return dim('No kit skills on this device.');
  }

  const lines: string[] = [];
  const header = opts?.header ?? DEFAULT_SYNC_HEADER;
  lines.push(bold(header));
  if (opts?.offline) {
    lines.push(dim('  (offline, grouped from local state)'));
  }
  lines.push('');

  const slugWidth = Math.min(
    48,
    Math.max(12, ...kitGroups.flatMap((g) => g.skills.map((s) => s.slug.length))),
  );

  for (const group of kitGroups) {
    lines.push(
      bold(group.kitRef) +
        dim(`  (${group.skills.length} skill${group.skills.length === 1 ? '' : 's'})`),
    );
    for (const skill of group.skills) {
      const reason = opts?.skipReasons?.get(skill.slug);
      lines.push(formatSkillRow(skill, slugWidth, reason));
    }
    lines.push('');
  }

  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

export function renderKitList(
  rawGroups: KitSkillGroup[],
  opts?: { registryOnly?: boolean; awaitingConsent?: ReadonlySet<string> },
): string {
  // The bundled /skillet router is Skillet's own plumbing — it appears in
  // machine surfaces (--json is the desktop's read contract) but never in a
  // human list of "your skills".
  const groups = rawGroups
    .map((g) => ({ ...g, skills: g.skills.filter((s) => s.slug !== BUNDLED_ROUTE_SLUG) }))
    .filter((g) => g.skills.length > 0);
  const lines: string[] = [];
  const total = groups.reduce((n, g) => n + g.skills.length, 0);
  const synced = groups
    .filter((g) => g.kitRef !== null)
    .reduce((n, g) => n + g.skills.length, 0);
  const localOnly = total - synced;

  // The breakdown only appears when there IS a breakdown: with everything
  // kit-synced, "17 skills — 17 synced from kits" says one number twice.
  lines.push(
    localOnly > 0
      ? bold(`${total} skill${total === 1 ? '' : 's'}`) + dim(`, ${localOnly} not in a kit`)
      : bold(`${total} skill${total === 1 ? '' : 's'}`),
  );
  lines.push('');

  const slugWidth = Math.min(
    48,
    Math.max(
      12,
      ...groups.flatMap((g) => g.skills.map((s) => s.slug.length)),
    ),
  );

  for (const group of groups) {
    const header =
      group.kitRef !== null
        ? bold(group.kitRef) + dim(`  (${group.skills.length} skill${group.skills.length === 1 ? '' : 's'})`)
        : yellow('Not in a kit') + dim('  (local imports, not synced to agents)');
    lines.push(header);

    const kitAuthor =
      group.kitRef !== null ? (group.kitRef.replace(/^@/, '').split('/')[0] ?? null) : null;
    for (const skill of group.skills) {
      const row = formatSkillRow(skill, slugWidth, undefined, kitAuthor);
      lines.push(
        opts?.awaitingConsent?.has(skill.slug) ? `${row}  ${dim('waiting for your OK')}` : row,
      );
    }
    lines.push('');
  }

  if (groups.length > 0 && groups[groups.length - 1].skills.length >= 0) {
    lines.pop(); // trailing blank
  }

  if (opts?.registryOnly) {
    lines.push(
      dim('Registry view. Run `skillet sync` to pull skills onto this machine.'),
    );
  } else if (localOnly > 0 && synced === 0) {
    lines.push(
      dim('No kit skills yet. Sign in and run `skillet sync`, or add skills to a kit on the web.'),
    );
  }

  return lines.join('\n');
}
