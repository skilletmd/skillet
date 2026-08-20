import { dim, padEndVisible, visibleLength } from "./cli-colors.js";

/**
 * The Skillet face, quadrant-block-rendered from the desktop app icon
 * (src-tauri/icons/128x128.png): a solid tile with the wink chevron, donut
 * eye, and smile knocked out, so grouty terminal line spacing can't shatter
 * it into floating pieces. Every bare run opens with it, Claude Code style —
 * face on the left, info column beside it. No color — the shape is the brand.
 */
export const SKILLET_FACE = [
  "▗████████▖",
  "██▄▀██▀▀██",
  "███▀▄█ ▘██",
  "██▄▛▜█▀███",
  "▝███▄▄▟██▘",
];

/** Column where the info lines start, past the widest face row. */
const INFO_COLUMN = 14;

/** Face row the first info line sits beside (centers 3 lines on 5 rows). */
const INFO_START_ROW = 1;

/**
 * Launch banner: the face with up to three info lines beside it — name and
 * version first, then whatever the run knows (skill count, agents, machine).
 * The face renders dim: full-brightness block mass overpowers the text, and
 * dim tracks the user's theme where a hardcoded gray would not.
 */
export function launchBanner(
  infoLines: string[],
  width = process.stdout.columns ?? 80,
): string {
  const lines = SKILLET_FACE.map((row) => dim(row));
  const longest = Math.max(0, ...infoLines.map(visibleLength));
  // Never let the terminal wrap mid-face — a sheared row of blocks reads as
  // garbage. When the side-by-side layout doesn't fit, stack instead.
  if (width < INFO_COLUMN + longest) {
    return [...lines, "", ...infoLines].join("\n");
  }
  infoLines.slice(0, lines.length - INFO_START_ROW).forEach((info, i) => {
    const row = INFO_START_ROW + i;
    lines[row] = padEndVisible(lines[row]!, INFO_COLUMN) + info;
  });
  return lines.join("\n");
}
