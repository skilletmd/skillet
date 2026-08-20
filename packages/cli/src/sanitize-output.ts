/**
 * Strip terminal control/escape sequences from untrusted text before printing.
 *
 * Registry-supplied proposal diffs (file paths + diff content) are
 * attacker-controlled; printed raw they can carry ANSI/OSC escape sequences
 * that rewrite the screen, spoof prompts, or alter the clipboard/title. Tabs
 * and the visible text are preserved; ESC
 * sequences and other C0/C1 control characters are removed.
 */
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g; // OSC: ESC ] ... BEL|ST
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]/g; // CSI + 2-char escapes
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g; // C0/C1 except \t (0x09) and \n (0x0a)

export function stripControlChars(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(CONTROL, "");
}

/**
 * Render a registry scan finding (a `scan_blocked` refusal) for the terminal
 * WITHOUT the matched value. A secret's bytes ARE the secret, so they must never
 * be printed — show only the location + category.
 * Shared by the `publish`, `propose`, and `edits propose` commands, which all
 * surface the same registry `scan_blocked` body.
 */
export function formatScanFinding(f: { file: string; lineStart: number; category: string }): string {
  return `  ${f.file}:${f.lineStart} [${f.category}] (matched value redacted)`;
}
