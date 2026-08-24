// Supply-chain tampering.
//
// SC2 (remote-fetch → execute beyond the plain curl|sh that exfil already
// catches) and SC3 (decode-then-exec obfuscation) are unambiguous code-exec
// shapes with no legitimate read-time use; they are `high` and script-gated, so
// they cannot fire on a markdown instruction file (the catalog is markdown-only)
// and only quarantine real executable payloads. SC1 (unpinned dependencies) is
// a hygiene smell, not an attack: `low` and gated to dependency manifests.

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile, isManifestFile, isContainerRecipeFile } from '../util.js';
import { isShebangScript } from '../../file-classes.js';

const codeOrContainer = (_m: RegExpExecArray, file: string, contents: string) =>
  isScriptFile(file) || isContainerRecipeFile(file) || isShebangScript(file, contents);
const onlyManifests = (_m: RegExpExecArray, file: string, _contents: string) => isManifestFile(file);

const PATTERNS = [
  // SC2 — fetch a remote script and pipe it to an interpreter (curl|python,
  // wget|node, curl -o x && sh) or programmatically exec a fetched body.
  {
    category: 'supply-chain' as const,
    detector: 'fetch-pipe-interpreter',
    confidence: 'high' as const,
    // The attack is a BARE interpreter: `curl … | python3` runs the fetched
    // bytes as code. `curl … | python3 tool.py` (or `| python3 -m json.tool`)
    // does not — the interpreter runs a local, separately-scanned script and
    // the fetched bytes arrive on stdin as DATA. That shape is how a CLI filter
    // is documented, and firing on it quarantined K-Dense's paper-lookup for the
    // usage examples in its own arxiv/PMC parsers' docstrings.
    //
    // So the trailing lookahead rejects a match once a TARGET follows: `-m
    // <module>`, or any token not starting with `-`. Short option flags are
    // skipped over first, so `| python3 -u tool.py` is still a target and
    // `| python3 -u` is still bare. `-c`/`-e` are deliberately NOT skippable —
    // `curl … | python3 -c '…'` takes code on the command line and has no
    // honest reading, so it keeps firing. Horizontal-only whitespace
    // (`[^\S\n]`) keeps the lookahead from stepping over a line break and
    // mistaking the next line's first word for a script argument.
    pattern:
      /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:python3?|node|ruby|perl)\b(?!(?:[^\S\n]+-(?![A-Za-z]*[cem])[A-Za-z]+)*[^\S\n]+(?:-m\b|[^-\s]))/gi,
    accept: codeOrContainer,
  },
  {
    category: 'supply-chain' as const,
    detector: 'fetch-then-exec',
    confidence: 'high' as const,
    // curl ... -o file && sh file   /   wget ... -O file && bash file
    pattern:
      /\b(?:curl|wget)\b[^&\n]{0,200}-[oO]\s+\S+\s*&&\s*(?:sudo\s+)?(?:ba)?sh\b/gi,
    accept: codeOrContainer,
  },
  {
    category: 'supply-chain' as const,
    detector: 'exec-fetched-body',
    confidence: 'high' as const,
    // exec(requests.get(...).text) / eval(urllib...read()) / eval(fetch(...)) /
    // new Function(fetch(...)) / subprocess(...curl http...)
    pattern:
      /\b(?:exec|eval)\s*\(\s*(?:urllib|requests|httpx)\.[^)]+\.(?:read|text|content)|\beval\s*\(\s*(?:await\s+)?fetch\s*\(|\bnew\s+Function\s*\([^)]*fetch\s*\(|\bsubprocess\.[^(]+\([^)]*(?:curl|wget)\s+https?:\/\//gi,
    accept: codeOrContainer,
  },
  {
    category: 'supply-chain' as const,
    detector: 'exec-fetched-alias',
    confidence: 'high' as const,
    // exec/eval of a fetched body reached through an IMPORT ALIAS — e.g.
    // `import urllib.request as u; exec(u.urlopen(url).read())`, or the same in
    // a `python -c "…"` one-liner — which dodges the module-prefixed form above.
    pattern: /\b(?:exec|eval)\s*\(\s*[^)\n]{0,100}\b(?:urlopen|urlretrieve)\s*\(/gi,
    accept: codeOrContainer,
  },
  {
    category: 'supply-chain' as const,
    detector: 'fetch-file-then-run',
    confidence: 'high' as const,
    // Staged drive-by across separate statements: download to a path with -o/-O,
    // then `chmod +x` and execute it. Dodges fetch-then-exec's single-line `&&`.
    pattern:
      /\b(?:curl|wget)\b[^\n]*-[a-zA-Z]*[oO]\s+\S+[\s\S]{0,200}?\bchmod\s+\+x\b[\s\S]{0,80}?(?:\.\/|\/(?:tmp|var|dev\/shm))\S+/gi,
    accept: codeOrContainer,
  },
  // SC3 — decode-then-execute and runtime-import obfuscation.
  {
    category: 'supply-chain' as const,
    detector: 'exec-decoded-payload',
    confidence: 'high' as const,
    // exec(b64decode(...)), eval(atob(...)), exec(marshal.loads(...)),
    // exec(bytes.fromhex(...)), exec(zlib.decompress(...)), exec(codecs.decode(...,'hex'))
    pattern:
      /\b(?:exec|eval)\s*\(\s*(?:(?:base64\.)?b64decode|atob|marshal\.loads|bytes\.fromhex|bytearray\.fromhex|(?:zlib|gzip)\.decompress|codecs\.decode)\s*\(/gi,
    accept: codeOrContainer,
  },
  {
    category: 'supply-chain' as const,
    detector: 'dynamic-os-import',
    confidence: 'high' as const,
    // __import__('os').system(...) — runtime import to dodge static import scan.
    pattern: /\b__import__\s*\(\s*['"]os['"]\s*\)\s*\.\s*(?:system|popen)/g,
    accept: codeOrContainer,
  },
  // SC1 — unpinned dependencies in a manifest (hygiene, advisory only).
  {
    category: 'supply-chain' as const,
    detector: 'unpinned-dependency',
    confidence: 'low' as const,
    // "pkg": "*" | "latest" | "pkg == *" in a dependency manifest.
    pattern: /"[^"]+"\s*:\s*"(?:\*|latest)"|^[a-zA-Z][\w-]*\s*==\s*\*\s*$/gm,
    accept: onlyManifests,
  },
];

export const supplyChainDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
