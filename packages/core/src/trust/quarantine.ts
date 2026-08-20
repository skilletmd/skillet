/**
 * Quarantine-gate prompt. Runs AFTER the standard graded-diff
 * approval, so the user has already seen the byte-level diff. This prompt
 * surfaces the scan findings_summary and demands a literal `understood`
 * acknowledgement before any adapter write.
 *
 * Security invariants:
 *   - Default is deny. Only the literal phrase `understood` (case-insensitive)
 *     approves the materialization.
 *   - Non-TTY contexts auto-deny; only the explicit `allowQuarantined` SyncOptions
 *     flag (or pre-recorded lock entry) lets non-interactive runs proceed.
 *   - The findings_summary is always printed before the prompt — callers must
 *     not suppress it.
 */

import { createInterface } from "node:readline";
import type { Writable, Readable } from "node:stream";
import type { ScanManifestInfo } from "@skillet/protocol";

const EXTRA_CONSENT_PHRASE = "understood";

// Scan findings carry registry-supplied text (file paths, categories, "why"
// strings). Printed raw they could smuggle terminal escape sequences into the
// consent prompt — sanitize at the source so every consumer (sync's gate, the
// menu's scanSummary, `skillet pending`) inherits it. Mirrors the CLI's
// sanitize-output regexes; \t and \n survive.
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -\/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
function sanitize(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(CONTROL, "");
}

export function renderFindingsSummary(scan: ScanManifestInfo): string {
  const { status, findings_summary: s } = scan;
  const header =
    status === "quarantined"
      ? "⚠  QUARANTINED — harm scan found high-confidence findings"
      : status === "flagged"
        ? "⚠  Flagged — harm scan surfaced findings worth reviewing"
        : "⚠  Scan pending — server has not finished scanning this version";
  const lines: string[] = [header];

  if (status === "pending") {
    lines.push("  Try again in a moment, or run `skillet sync` once the scan completes.");
    return lines.join("\n");
  }

  lines.push(
    `  Top confidence: ${sanitize(String(s.topConfidence ?? "n/a"))} · total findings: ${s.total}`,
  );
  for (const cat of Object.keys(s.counts) as Array<keyof typeof s.counts>) {
    const bucket = s.counts[cat] ?? {};
    const parts = (['high', 'medium', 'low'] as const)
      .filter((sev) => (bucket[sev] ?? 0) > 0)
      .map((sev) => `${sev}=${bucket[sev]}`);
    if (parts.length > 0) lines.push(`  ${sanitize(String(cat))}: ${parts.join(' ')}`);
  }
  if (s.highlights.length > 0) {
    lines.push("  Highlights:");
    for (const h of s.highlights) {
      lines.push(
        `    [${sanitize(String(h.confidence))}] ${sanitize(h.category)} · ${sanitize(h.file)} (${sanitize(h.why)})`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Extra-consent prompt for quarantined versions. Returns true ONLY when the
 * user types the literal phrase `understood`. EOF, non-TTY, and any other
 * input return false.
 */
export async function promptQuarantineConsent(
  scan: ScanManifestInfo,
  slug: string,
  output: Writable,
  input: Readable,
): Promise<boolean> {
  output.write("\n" + renderFindingsSummary(scan) + "\n");

  const isTTY = (output as NodeJS.WriteStream).isTTY === true;
  if (!isTTY) {
    output.write(
      `\nQuarantined skill "${slug}" cannot be applied in a non-interactive run without --allow-quarantined.\n`,
    );
    return false;
  }

  return new Promise<boolean>((resolve) => {
    output.write(
      `\nThis skill is quarantined. Type "${EXTRA_CONSENT_PHRASE}" to apply it anyway: `,
    );
    const rl = createInterface({ input, output, terminal: false });
    let settled = false;
    rl.once("line", (line: string) => {
      settled = true;
      rl.close();
      resolve(line.trim().toLowerCase() === EXTRA_CONSENT_PHRASE);
    });
    rl.once("close", () => {
      if (!settled) resolve(false);
    });
  });
}

/**
 * Pure helper: should sync invoke the quarantine gate for this entry?
 *
 * Quarantined is the only blocking status — flagged surfaces in the diff but
 * does not stop materialization. Pending is opt-in safe: we treat it as
 * non-clean for `skillet status` listings but only require extra consent at
 * publish-replay time once the scan resolves.
 */
export function requiresQuarantineConsent(
  scan: ScanManifestInfo | undefined,
): boolean {
  return scan?.status === "quarantined";
}
