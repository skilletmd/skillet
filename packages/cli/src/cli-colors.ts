// SKILLET_FORCE_COLOR is for transcript capture (the copy-review page), where
// output is piped but should still show the real look.
const useColor = process.stdout.isTTY === true || process.env['SKILLET_FORCE_COLOR'] === '1';

export function cliColor(code: string, text: string): string {
  if (!useColor) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export const bold = (s: string) => cliColor('1', s);
export const dim = (s: string) => cliColor('2', s);
export const cyan = (s: string) => cliColor('36', s);
export const yellow = (s: string) => cliColor('33', s);
export const green = (s: string) => cliColor('32', s);
export const red = (s: string) => cliColor('31', s);

// Status lines: color annotates, never decorates. The glyph carries the
// verdict in color; the message stays plain.
export const ok = (msg: string) => `${green('✓')} ${msg}`;
export const fail = (msg: string) => `${red('✗')} ${msg}`;

export function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

export function padEndVisible(text: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(pad);
}
