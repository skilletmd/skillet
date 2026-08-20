// LaTeX is not inert: it can execute shell commands at compile time. The
// classic vector is `\write18{cmd}` (shell-escape); TeX's `\input`/`\openin`
// can pipe through a shell (`\input{|"cmd"}`), and LuaTeX's `\directlua` can
// call `os.execute`. A `.tex`/`.sty` shipped in a skill is therefore a real
// (if narrow) code-execution surface, not a document to wave through. We flag
// the execution primitives at MEDIUM — advisory, since legitimate packages
// (e.g. `minted` → pygments) use `\write18` too, so it warrants a look, not a
// hard block. Runs only on LaTeX files.
import type { Detector, Finding } from '../../types.js';
import { runPattern } from '../util.js';
import { isLatexFile } from '../../file-classes.js';

const PATTERNS = [
  {
    category: 'risky-call' as const,
    detector: 'latex-shell-escape',
    confidence: 'medium' as const,
    // `\write18{…}`, `\immediate\write18{…}`, and the expl3 `\ShellEscape`/`\sys_shell_now`.
    pattern:
      /\\(?:immediate\s*)?write18\b|\\ShellEscape\b|\\sys_shell_(?:now|shipout):n/gi,
  },
  {
    category: 'risky-call' as const,
    detector: 'latex-input-pipe',
    confidence: 'medium' as const,
    // Piped file read/write through the shell: `\input{|"cmd"}`, `\openin\f=|cmd`,
    // `\openout\f=|cmd`. The `|` after the opener is the kpathsea pipe.
    pattern: /\\(?:input|include|openin|openout|read)\b[^\n{|]{0,20}[{=]?\s*\|/gi,
  },
  {
    category: 'risky-call' as const,
    detector: 'latex-lua-exec',
    confidence: 'medium' as const,
    // LuaTeX code execution: `\directlua{ … os.execute(…) … }` / `io.popen`.
    pattern: /\\(?:directlua|latelua)\b[^\n]{0,80}?\b(?:os\.execute|io\.popen)\b/gi,
  },
];

export const latexDetector: Detector = (filePath, contents) => {
  if (!isLatexFile(filePath)) return [];
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
