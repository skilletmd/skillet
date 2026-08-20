import { cyan, dim, green } from './cli-colors.js';
import { printRenderedError } from './render-error.js';

export interface AddPresentOptions {
  color?: boolean;
  json?: boolean;
}

let colorEnabled = process.stdout.isTTY === true;

export function configureAddPresent(opts: AddPresentOptions): void {
  if (opts.json === true) {
    colorEnabled = false;
    return;
  }
  if (opts.color === false) {
    colorEnabled = false;
  }
}

function paint(code: string, text: string): string {
  if (!colorEnabled) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

const stepPrefix = () => paint('2', '│');

export function printAddBanner(): void {
  // skills.sh-style add stays quiet at the top — steps carry the story.
}

export function printStepInfo(message: string): void {
  console.log(`${stepPrefix()} ${paint('36', '◇')} ${message}`);
}

export function printStepSelect(message: string, highlight?: string): void {
  const body = highlight ? message.replace(highlight, cyan(highlight)) : message;
  console.log(`${stepPrefix()} ${paint('34', '◆')} ${body}`);
}

export function printStepSuccess(message: string): void {
  console.log(`${stepPrefix()} ${green('◆')} ${message}`);
}

export function printAddHint(message: string): void {
  console.log(dim(message));
}

export function printAddError(message: string): void {
  // House convention: the glyph carries the verdict in color, message plain.
  // The renderer maps internal codes to a sentence + next action and strips
  // control characters from registry-supplied text.
  printRenderedError(message, (what) => `${paint('31', '✗')} ${what}`);
}
