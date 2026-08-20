import type { PullOutcome } from '@skillet/core';
import { formatAuthorKeyMismatchHint, parseAuthorKeyMismatch } from '@skillet/core';
import { renderErrorLines } from './render-error.js';

/** Render a failed pull line plus optional author-key recovery hints. */
export function renderFailedPullLine(outcome: PullOutcome): string[] {
  const [what, ...next] = renderErrorLines(outcome.reason ?? 'pull_failed');
  const lines = [`  ✗ ${outcome.slug}: ${what}`, ...next.map((n) => `  ${n}`)];
  const mismatch = outcome.authorKeyMismatch ?? parseAuthorKeyMismatch(outcome.reason ?? '');
  if (mismatch) {
    lines.push(...formatAuthorKeyMismatchHint(mismatch));
  }
  return lines;
}

/** Unique author handles that failed sync due to key rotation. */
export function authorKeyMismatchHandles(outcomes: PullOutcome[]): string[] {
  const handles = new Set<string>();
  for (const outcome of outcomes) {
    const mismatch = outcome.authorKeyMismatch ?? parseAuthorKeyMismatch(outcome.reason ?? '');
    if (mismatch) handles.add(mismatch.handle);
  }
  return [...handles];
}
