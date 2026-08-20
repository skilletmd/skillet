// Category-classifier eval: run the live classifier over the labeled corpus,
// score top-1 accuracy, and build a confusion matrix so prompt/model changes
// are measurable. Sibling to scanner/corpus-report. Requires ANTHROPIC_API_KEY
// (the classifier no-ops without it, which the runner reports as a hard error
// rather than a silent 0%).

import { CATEGORY_KEYS, type CategoryKey } from '../categories.js';
import { classifySkill } from './index.js';
import { CLASSIFY_EVAL_CORPUS, type ClassifyEvalCase } from './eval-corpus.js';

export interface CaseResult {
  id: string;
  slug: string;
  expected: CategoryKey;
  got: CategoryKey | null;
  correct: boolean;
  note?: string;
}

export interface ClassifyEvalReport {
  total: number;
  correct: number;
  /** Top-1 accuracy over cases the model labeled (excludes null/uncategorized). */
  accuracy: number;
  /** Cases where the classifier returned null. */
  unlabeled: number;
  results: CaseResult[];
  /** perCategory[expected] = { total, correct }. */
  perCategory: Record<string, { total: number; correct: number }>;
  /** confusion[expected][got] = count, for the mislabeled pairs only. */
  confusion: Record<string, Record<string, number>>;
}

export async function runClassifyEval(
  corpus: ClassifyEvalCase[] = CLASSIFY_EVAL_CORPUS,
): Promise<ClassifyEvalReport> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — the classifier no-ops without it, so the eval cannot run.',
    );
  }

  const results: CaseResult[] = [];
  for (const c of corpus) {
    const got = await classifySkill({ slug: c.slug, description: c.description, body: c.body });
    results.push({
      id: c.id,
      slug: c.slug,
      expected: c.expected,
      got,
      correct: got === c.expected,
      note: c.note,
    });
  }

  const perCategory: Record<string, { total: number; correct: number }> = {};
  const confusion: Record<string, Record<string, number>> = {};
  let correct = 0;
  let unlabeled = 0;

  for (const r of results) {
    perCategory[r.expected] ??= { total: 0, correct: 0 };
    perCategory[r.expected].total++;
    if (r.correct) {
      perCategory[r.expected].correct++;
      correct++;
    } else {
      const gotKey = r.got ?? '(uncategorized)';
      if (r.got === null) unlabeled++;
      confusion[r.expected] ??= {};
      confusion[r.expected][gotKey] = (confusion[r.expected][gotKey] ?? 0) + 1;
    }
  }

  return {
    total: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    unlabeled,
    results,
    perCategory,
    confusion,
  };
}

export function formatClassifyEvalMarkdown(report: ClassifyEvalReport): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
  const lines: string[] = [];

  lines.push('# Category classifier eval');
  lines.push('');
  lines.push(
    `**Top-1 accuracy: ${pct(report.correct, report.total)}** (${report.correct}/${report.total})` +
      (report.unlabeled ? ` · ${report.unlabeled} returned uncategorized` : ''),
  );
  lines.push('');

  // Per-category accuracy, full taxonomy (0-coverage categories flagged).
  lines.push('## Per-category');
  lines.push('');
  lines.push('| category | correct | total | acc |');
  lines.push('| --- | --- | --- | --- |');
  for (const key of CATEGORY_KEYS) {
    const pc = report.perCategory[key];
    if (!pc) {
      lines.push(`| ${key} | — | 0 | _no cases_ |`);
      continue;
    }
    lines.push(`| ${key} | ${pc.correct} | ${pc.total} | ${pct(pc.correct, pc.total)} |`);
  }
  lines.push('');

  // Misclassifications as expected→got pairs.
  const misses = report.results.filter((r) => !r.correct);
  lines.push(`## Misclassifications (${misses.length})`);
  lines.push('');
  if (misses.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| slug | expected | got | note |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of misses) {
      lines.push(
        `| ${r.slug} | ${r.expected} | ${r.got ?? '(uncategorized)'} | ${r.note ?? ''} |`,
      );
    }
  }
  lines.push('');

  // Confusion pairs, most frequent first.
  const pairs: Array<{ from: string; to: string; n: number }> = [];
  for (const [from, row] of Object.entries(report.confusion)) {
    for (const [to, n] of Object.entries(row)) pairs.push({ from, to, n });
  }
  pairs.sort((a, b) => b.n - a.n);
  if (pairs.length) {
    lines.push('## Confused pairs');
    lines.push('');
    for (const p of pairs) lines.push(`- ${p.from} → ${p.to} ×${p.n}`);
    lines.push('');
  }

  return lines.join('\n');
}
