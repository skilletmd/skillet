// Destructive command shapes.
//
// Conservative — every pattern here describes something with no read-side
// legitimate use in a SKILL.md or a setup script. `high` confidence across
// the board because the cost of a false negative dwarfs the cost of a few
// flagged-as-quarantined drafts.

import type { Detector, Finding } from '../../types.js';
import { runPattern, notDefensive } from '../util.js';
import { isMarkdownFile } from '../../file-classes.js';

// A `DROP TABLE` shown as a SQL best-practice/example in prose is documentation,
// not an executed destruction. The shared `notDefensive` acceptor (util.ts)
// skips it when a describing/teaching marker sits near the match; a real `DROP
// TABLE` in a script (no such markers) still fires.

// SQL wipes whose confidence depends on file role: a real `DROP TABLE x;` in a
// `.sql`/migration runs; the same statement in a best-practices `.md` is an
// illustrative example (often a `-- commented` warning). Downgrade ONLY those
// two SQL detectors, ONLY in markdown, to a visible MEDIUM flag — a real DROP in
// a `.sql`/script stays HIGH and quarantines, as do all the shell wipes.
const SQL_DESTRUCTIVE = new Set(['destructive:drop-table', 'destructive:truncate-table']);

const PATTERNS = [
  {
    category: 'destructive' as const,
    detector: 'rm-rf-root',
    confidence: 'high' as const,
    // Catastrophic wipes ONLY: rm -rf of root (/ or /*), home (~ , ~/ , ~/* ,
    // $HOME...), or parent (.. , ../*). A boundary lookahead means a deeper
    // path like `/var/lib/apt/lists/*` (the standard Dockerfile apt-cache
    // cleanup) is NOT a root wipe and is left alone. Tolerates flag order.
    pattern:
      /\brm\s+(?:-[a-zA-Z]+\s+)*-?(?:rf|fr|Rf|fR)\s+(?:--no-preserve-root\s+)?(?:\/\*?|(?:~|\$HOME)\/?\*?|\.\.\/?\*?)(?=[\s;|&)'"]|$)/g,
  },
  {
    category: 'destructive' as const,
    detector: 'find-delete-root',
    confidence: 'high' as const,
    // `find / -delete` / `find ~ … -exec rm` — a recursive wipe anchored at root
    // or home. Gated to an EXACT root/home start path (followed by whitespace)
    // so `find /var/log … -delete` (log rotation) and `find . -name '*.tmp'
    // -delete` (local cleanup) do NOT match.
    pattern: /\bfind\s+(?:\/|~|\$HOME)\s+[^\n]*(?:-delete\b|-exec\s+rm\b)/gi,
  },
  {
    category: 'destructive' as const,
    detector: 'rm-rf-root',
    confidence: 'high' as const,
    // Split short flags: `rm -f -r /` (f before r).
    pattern:
      /\brm\s+(?:-[a-zA-Z]+\s+)*-[fF]\s+(?:-[a-zA-Z]+\s+)*-[rR]\s+(?:--no-preserve-root\s+)?(?:\/\*?|(?:~|\$HOME)\/?\*?|\.\.\/?\*?)(?=[\s;|&)'"]|$)/g,
  },
  {
    category: 'destructive' as const,
    detector: 'rm-rf-root',
    confidence: 'high' as const,
    // Space-separated flags: `rm -r -f /` (r before f).
    pattern:
      /\brm\s+(?:-[a-zA-Z]+\s+)*-[rR]\s+(?:-[a-zA-Z]+\s+)*-[fF]\s+(?:--no-preserve-root\s+)?(?:\/\*?|(?:~|\$HOME)\/?\*?|\.\.\/?\*?)(?=[\s;|&)'"]|$)/g,
  },
  {
    category: 'destructive' as const,
    detector: 'rm-rf-root',
    confidence: 'high' as const,
    // Long-form GNU flags: `rm --recursive --force /`.
    pattern:
      /\brm\s+--recursive\s+--force\s+(?:--no-preserve-root\s+)?(?:\/\*?|(?:~|\$HOME)\/?\*?)(?=[\s;|&)'"]|$)/gi,
  },
  {
    category: 'destructive' as const,
    detector: 'fork-bomb',
    confidence: 'high' as const,
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/g,
  },
  {
    category: 'destructive' as const,
    detector: 'mkfs',
    confidence: 'high' as const,
    pattern: /\bmkfs(?:\.[a-zA-Z0-9]+)?\b\s+[^\s;|&]+/g,
  },
  {
    category: 'destructive' as const,
    detector: 'dd-of-device',
    confidence: 'high' as const,
    pattern: /\bdd\b[^\n]{0,80}\bof=\/dev\/[a-z0-9]+/gi,
  },
  {
    category: 'destructive' as const,
    detector: 'shred-device',
    confidence: 'high' as const,
    // Wiping a real block device. Exclude the safe pseudo-files (/dev/null, etc.)
    // so a benign `shred -u file 2>/dev/null` (secure temp-file delete) isn't read
    // as a device wipe via its stderr redirect.
    pattern:
      /\bshred\b[^\n]{0,80}\/dev\/(?!(?:null|zero|full|random|urandom|tty|std(?:in|out|err)|console)\b)[a-z0-9]+/gi,
  },
  {
    category: 'destructive' as const,
    detector: 'chmod-recursive-world',
    confidence: 'medium' as const,
    pattern: /\bchmod\s+(?:-[a-zA-Z]+\s+)*-?R[a-zA-Z]*\s+(?:777|a\+rwx|0?777)\b/g,
  },
  {
    category: 'destructive' as const,
    detector: 'drop-table',
    confidence: 'high' as const,
    // Require an actual object name after the keyword (optionally `IF EXISTS`), so
    // a real `DROP TABLE users` hits but documentation prose listing the keyword
    // as a noun ("drop database", a "DROP schema" permission row) does not.
    pattern:
      /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX)\s+(?:IF\s+EXISTS\s+)?["'`[]?[A-Za-z_][\w.$]*/gi,
    accept: notDefensive,
  },
  {
    category: 'destructive' as const,
    detector: 'truncate-table',
    confidence: 'high' as const,
    // Real SQL only: `TRUNCATE TABLE x` (keyword form) OR `TRUNCATE x;` (a
    // terminated statement). The old optional-TABLE form matched the plain
    // English verb "truncate" (truncate a string / with an ellipsis) and
    // quarantined legitimate docs and scripts. This keeps full recall on actual
    // SQL while dropping the prose false positives.
    pattern: /\bTRUNCATE\s+TABLE\s+[a-zA-Z_][\w.]*|\bTRUNCATE\s+[a-zA-Z_][\w.]*\s*;/gi,
  },
  {
    category: 'destructive' as const,
    detector: 'sudo-rm',
    confidence: 'high' as const,
    pattern: /\bsudo\b\s+rm\s+(?:-[a-zA-Z]+\s+)*-?(?:rf|fr|Rf|fR)(?:\s+(?:\/\*?|~|\$HOME|\.\.))?\b/g,
  },
  {
    category: 'destructive' as const,
    detector: 'rebind-host',
    confidence: 'medium' as const,
    // appending to /etc/hosts is a common credential-phish primitive
    pattern: /(?:>>?\s*\/etc\/hosts\b|tee\s+(?:-a\s+)?\/etc\/hosts\b)/g,
  },
];

export const destructiveDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  if (!isMarkdownFile(filePath)) return out;
  return out.map((f) => (SQL_DESTRUCTIVE.has(f.why) ? { ...f, confidence: 'medium' as const } : f));
};
