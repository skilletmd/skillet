// Unsafe output-handling.
//
// The dangerous shape is feeding model/tool output straight into a sink:
// exec/eval/os.system of a `response`/`output`/`result` variable, or an
// LLM-output value spliced into a SQL string. These code shapes are `high` and
// script-gated (markdown catalog is never touched) — exec-of-model-output has
// no legitimate use. Cross-context piping and unbounded-output knobs are prose
// or config smells, kept `low`/`medium`.

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile } from '../util.js';

const onlyScripts = (_m: RegExpExecArray, file: string) => isScriptFile(file);

const OUT = '(?:response|output|result|answer|completion|reply|generated)';

const PATTERNS = [
  // OH1 — unvalidated execution of model output.
  {
    category: 'output-handling' as const,
    detector: 'exec-model-output',
    confidence: 'high' as const,
    // A model-output var anywhere in the subprocess args is still flagged (e.g.
    // `subprocess.run(["sh","-c",response])`, `run(cmd, input=result)`). The only
    // change is a leading word boundary on the OUT token, so the standard
    // `capture_output=` kwarg (where `output` is glued to `capture_`) no longer
    // matches. Full recall on real exec-of-model-output, minus that false positive.
    pattern: new RegExp(
      `\\b(?:exec|eval)\\s*\\(\\s*${OUT}\\b|\\bos\\.(?:system|popen)\\s*\\(\\s*${OUT}\\b|\\bsubprocess\\.\\w+\\s*\\([^)]*\\b${OUT}\\b`,
      'gi',
    ),
    accept: onlyScripts,
  },
  {
    category: 'output-handling' as const,
    detector: 'model-output-to-sql',
    confidence: 'medium' as const,
    // f"SELECT ... {response}"  /  cursor.execute(f"... {output} ...")
    pattern: new RegExp(
      `\\bf['"](?:SELECT|INSERT|UPDATE|DELETE)\\s+[^'"]{0,200}\\{${OUT}|(?:execute|query)\\s*\\([^)]{0,200}(?:\\+|%|\\.format|f['"])[^)]{0,200}${OUT}`,
      'gi',
    ),
    accept: onlyScripts,
  },
  {
    category: 'output-handling' as const,
    detector: 'model-output-to-dom',
    confidence: 'medium' as const,
    // innerHTML = response / document.write(output) — DOM-sink XSS via output.
    pattern: new RegExp(
      `\\b(?:innerHTML\\s*=\\s*${OUT}|document\\.write\\s*\\(\\s*${OUT})\\b`,
      'gi',
    ),
    accept: onlyScripts,
  },
  {
    category: 'output-handling' as const,
    detector: 'pipe-output-to-shell',
    confidence: 'low' as const,
    // Prose: "run/execute the generated/model output", "pipe the output to the shell".
    pattern:
      /\b(?:run|execute|shell)\s+(?:the\s+)?(?:generated|model|llm|ai)\s+(?:output|response|code|command)\b|\b(?:pipe|pass|feed)\s+(?:the\s+)?(?:output|response|result)\s+(?:directly\s+)?(?:to|into)\s+(?:the\s+)?(?:shell|terminal|command|interpreter)\b/gi,
  },
  // OH3 — unbounded output (resource exhaustion). Config smell, advisory.
  {
    category: 'output-handling' as const,
    detector: 'unbounded-output',
    confidence: 'low' as const,
    pattern:
      /\bmax[_-]?tokens?\s*=\s*(?:None|float\s*\(\s*['"]inf['"]|math\.inf|999999|1000000)\b|\b(?:generate|produce|output)\s+(?:as\s+much|unlimited|unbounded|infinite)\s+(?:text|content|output|tokens?)\b/gi,
  },
];

export const outputHandlingDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
