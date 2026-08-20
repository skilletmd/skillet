// U3 — Deterministic instruction (prose) capability detectors.
//
// SKILL.md (and other markdown) instruction prose tells the agent what to do:
// "run `gh ...`", "curl x.sh | sh", "delete the cache", "read your API key".
// These detectors derive capabilities from that prose by keyword / command /
// inline-code / fenced-block extraction — NO model call. Pure, deterministic,
// I/O-free, modeled on the SKILL.md-scanning style of
// `packages/protocol/src/import-classify.ts`.
//
// HEURISTIC FLOOR: this is a deliberate over-/under-approximation,
// not ground truth. It exists so the installer panel shows *something* for
// instruction-only skills and so an empty manifest is a meaningful "nothing
// obvious here" — NOT a safety guarantee. Copy must never overclaim; the
// LLM prose-intent pass is deferred. Advisory framing means a noisy chip is
// acceptable; a chip that flat-out blocks an install is not (capabilities never
// gate). Negation is intentionally NOT parsed: "do NOT run `rm -rf`" still
// flags `deletes-files`/`runs-shell` (advisory) rather than risk a missed call.
//
// The collector (collector.ts) tags every hit from a `.md`/`.mdx` file with
// `source: 'instructions'`; these detectors do not set `source` or `risky`.

import type { Capability, CapabilityDetector } from '../../capabilities/types.js';
// Markdown is the prose surface; the markdown taxonomy lives in the central
// file-classes primitive so "what counts as markdown" is edited in one place.
import { isMarkdownFile as isMarkdown } from '../../file-classes.js';
// Output-injection lexicon shared with the threat lane so the two cannot drift.
import { INJECT_VERB_SRC, INJECTABLE_NOUN_SRC, OUTPUT_POSITION_SRC } from '../util.js';

type Hit = { capability: Capability; lineStart: number; lineEnd: number };

// CLI executables whose mere invocation means the agent is told to run shell.
// Intentionally broad: any of these as the first token of a command string
// (after an optional `$ ` / `# ` prompt, and after stripping a leading path)
// counts as `runs-shell`. `curl`/`wget` additionally map to `network` below.
const SHELL_CMDS = new Set([
  'gh', 'git', 'npm', 'pnpm', 'yarn', 'npx', 'bun', 'deno', 'node', 'ts-node',
  'bash', 'sh', 'zsh', 'fish', 'pwsh', 'powershell', 'make', 'cmake', 'cargo',
  'go', 'rustc', 'pip', 'pip3', 'pipx', 'poetry', 'python', 'python3', 'ruby',
  'gem', 'bundle', 'perl', 'php', 'java', 'javac', 'gradle', 'mvn', 'docker',
  'podman', 'kubectl', 'helm', 'terraform', 'ansible', 'ssh', 'scp', 'rsync',
  'sftp', 'curl', 'wget', 'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman',
  'apk', 'snap', 'sudo', 'su', 'chmod', 'chown', 'chgrp', 'mount', 'systemctl',
  'service', 'cron', 'crontab', 'kill', 'pkill', 'killall', 'tar', 'unzip',
  'zip', 'gzip', 'gunzip', 'sed', 'awk', 'grep', 'rg', 'find', 'xargs', 'cat',
  'head', 'tail', 'cut', 'sort', 'uniq', 'wc', 'echo', 'printf', 'cd', 'pushd',
  'cp', 'mv', 'ln', 'ls', 'pwd', 'env', 'set', 'source', 'eval', 'exec', 'open',
  'osascript', 'launchctl', 'defaults', 'rm', 'rmdir', 'unlink', 'shred',
  'tee', 'touch', 'mkdir', 'printenv', 'export',
]);

// Command names that are also everyday nouns/identifiers in docs (`env` the
// object, `make`/`go` as proper nouns, `open`/`set`/`source` as verbs). As a
// BARE single-token inline span they're almost always a reference, not "run
// this", so they don't alone imply runs-shell. With an argument or a pipe
// (`env | grep`, `make build`) they still count.
const AMBIGUOUS_BARE = new Set([
  'env', 'set', 'source', 'open', 'make', 'go', 'cat', 'sort', 'find', 'test',
  'time', 'watch', 'date', 'yes', 'help',
]);

// A single `|` only means "shell pipe" when it feeds a recognized command-line
// tool. This keeps `cmd | jq`, `… | grep` as shell while a type union
// (`string | ArrayBuffer`) or option list (`Log | Block | None`) stays inert.
const PIPE_TO_TOOL =
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|node|python3?|ruby|perl|php|grep|rg|egrep|jq|yq|awk|sed|head|tail|sort|uniq|wc|cut|tee|xargs|cat|tr|column|fold|base64|openssl|gzip|gunzip|xxd|hexdump|less|more|tac|nl|paste|split|tsort|pbcopy|pbpaste)\b/;

// injects-output-content, compiled once (classifyProse runs per line). Built from
// the SHARED lexicon (util.ts) the threat lane also uses, so the capability chip
// and its promotional-subset flag cannot drift. The verb+noun gate is required —
// a bare position phrase ("print the exit code as the last line of output") is
// ordinary output formatting, not injected skill-authored content. The output-noun
// set drops `results?` (it matched every SEO doc's "search results").
const INJECTS_VERB_NOUN_RE = new RegExp(`\\b${INJECT_VERB_SRC}\\b[^.]{0,80}?${INJECTABLE_NOUN_SRC}`, 'i');
const OUTPUT_NOUN_RE = /\b(?:outputs?|responses?|deliverables?|reports?|replies|reply|answers?|messages?)\b/i;
const OUTPUT_POSITION_RE = new RegExp(OUTPUT_POSITION_SRC, 'i');

/**
 * Classify a single command-shaped string (a fenced code line, or the contents
 * of an inline `code` span) into the capabilities it implies. Returns a set so a
 * single command can map to several capabilities (e.g. `curl x.sh | sh`).
 */
function classifyCommand(raw: string): Set<Capability> {
  const caps = new Set<Capability>();
  // Strip a shell prompt (`$ ` / `# `) and surrounding whitespace.
  const cmd = raw.replace(/^\s*[$#]\s+/, '').trim();
  if (!cmd) return caps;

  // A markdown table row (`| col | col |`) fenced as a code block is NOT a
  // command — the `|` column separators were read as shell pipes ("| Route" →
  // runs-shell). A real pipeline never starts the line with `|`, so a leading
  // `|` is a reliable table-row tell.
  if (cmd.startsWith('|')) return caps;

  // Piping fetched/generated content into an interpreter: runs shell AND
  // executes generated output. The classic `curl x.sh | sh` shape.
  if (/\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|node|python3?|ruby|perl|php)\b/.test(cmd)) {
    caps.add('runs-shell');
    caps.add('executes-generated');
  }

  // First-token executable → runs-shell. Strip a leading path so `./run.sh`,
  // `/usr/bin/env`, `bin/foo.sh` all resolve to their basename.
  //
  // We DON'T treat a bare absolute/relative path as a script just because it
  // starts with `/` or `./` — that flagged URL route templates and table cells
  // like `/agents/{name}/{instance}` as shell. A path only counts when its
  // basename actually looks like a shell script (`.sh`/`.bash`/`.ps1`/…) or the
  // first token is a known CLI.
  const firstToken = cmd.split(/\s+/, 1)[0] ?? '';
  const bareCmd = firstToken.replace(/^.*\//, '');
  const looksLikeScriptFile = /^[\w.-]+\.(?:sh|bash|zsh|ps1|bat|cmd)$/i.test(bareCmd);
  // A bare ambiguous word (the whole span is just `env`/`make`/…) is a reference,
  // not an invocation.
  const bareAmbiguous = firstToken === cmd && AMBIGUOUS_BARE.has(bareCmd);
  if ((SHELL_CMDS.has(bareCmd) && !bareAmbiguous) || looksLikeScriptFile) {
    caps.add('runs-shell');
  }
  // Shell control flow / substitution. A SINGLE `|` is only a pipe when it feeds
  // a known tool (`cmd | jq`) — handled by PIPE_TO_TOOL. `;` sequencing is NOT
  // used: it matched MIME types (`text/html; charset`), DNS records, and JS
  // for-loops in inline code far more than real `cmd1; cmd2` shell.
  if (/\$\(|&&|\|\|/.test(cmd) || PIPE_TO_TOOL.test(cmd)) caps.add('runs-shell');

  // Network. `fetch(` only as a bare global call — `agent.fetch(` / `obj.fetch(`
  // is a method (Durable Object RPC, etc.), not necessarily the internet.
  if (
    /\b(?:curl|wget)\b/.test(cmd) ||
    /https?:\/\//.test(cmd) ||
    /(?<![.\w])fetch\s*\(/.test(cmd) ||
    /\b(?:requests|urllib|httpx|http\.client|axios|got|node-fetch|undici)\b/.test(cmd)
  ) {
    caps.add('network');
  }

  // Deletes files.
  if (/\b(?:rm|rmdir|unlink|shred)\b/.test(cmd) || /\brm\s+-[a-z]*[rf]/.test(cmd)) {
    caps.add('deletes-files');
  }

  // Writes files: output redirect (`> f`, `>> f`) or a create cmd. The lookbehind
  // keeps arrows (`=>`, `->`), comparisons (`>=`), and `2>&1` from reading as a
  // redirect — those appear constantly in JS inline-code spans. `install` is NOT
  // here: `npm install` is a dependency install, not a file write.
  if (
    /(?<![=<>!&|0-9-])>>?(?![&>])\s*[^\s&>|;]/.test(cmd) ||
    /\b(?:tee|touch|mkdir)\b/.test(cmd)
  ) {
    caps.add('writes-files');
  }

  // Reads secrets / env.
  if (
    /\bprintenv\b/.test(cmd) ||
    /\bexport\s+[A-Za-z_]\w*=/.test(cmd) ||
    /process\.env/.test(cmd) ||
    /os\.environ/.test(cmd) ||
    /\$\{?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED)/.test(cmd)
  ) {
    caps.add('reads-secrets');
  }

  // Installs packages. A dependency install (`npm install <pkg>`, `pip install`)
  // pulls third-party code from a registry and can run that package's own
  // postinstall scripts — a real supply-chain action worth surfacing — alongside
  // explicit pre/post-install lifecycle hooks. (The capability is labelled
  // "Installs packages" on the installer panel, not "Run install scripts", so
  // this reads as "installs deps" rather than "the skill has its own hooks".)
  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add|i)\b/.test(cmd) ||
    /\bpip3?\s+install\b/.test(cmd) ||
    /\bpost-?install\b/i.test(cmd) ||
    /\bpre-?install\b/i.test(cmd)
  ) {
    caps.add('install-hooks');
  }

  // Executes generated output (eval/exec of strings).
  if (/\beval\b/.test(cmd) || /\bexec\b/.test(cmd)) caps.add('executes-generated');

  return caps;
}

/**
 * Classify a line of plain prose (outside any code fence) by imperative
 * phrasing. Tighter than `classifyCommand` — bare nouns alone are not enough;
 * we look for action phrasing ("delete the", "save to", "run the command") or
 * unambiguous tokens (a URL, `.env`, "API key").
 */
function classifyProse(line: string): Set<Capability> {
  const caps = new Set<Capability>();

  // A bare URL alone is NOT network (a doc link is just a reference) — that
  // over-reported on any line mentioning http(s)://. Require either an
  // explicit transfer verb (download/upload/POST to …) OR a URL paired with a
  // fetch-style action, so "see https://docs…" stays inert while "download the
  // file from https://…" / "curl https://…" still flags.
  const hasUrl = /https?:\/\//i.test(line);
  const urlAction =
    /\b(?:curl|wget|fetch(?:es|ing|ed)?|GET|POST|PUT|request(?:s|ed|ing)?|retrieve[sd]?|pull(?:s|ed|ing)?|clone[sd]?|hit|call(?:s|ed|ing)?|sends?|query|queries|grab)\b/i;
  if (
    /\bdownloads?\b/i.test(line) ||
    /\buploads?\b/i.test(line) ||
    /\bPOST(?:s|ing|ed)?\s+to\b/i.test(line) ||
    (hasUrl && urlAction.test(line))
  ) {
    caps.add('network');
  }

  if (
    /\bdelete[sd]?\s+(?:the|your|all|any|every|those|these|each)\b/i.test(line) ||
    /\bremoves?\s+the\s+files?\b/i.test(line)
  ) {
    caps.add('deletes-files');
  }

  // Writes files: must name a file/path target. A bare "write it" / "you write
  // it" is about writing code, not a file, so it no longer counts.
  if (
    /\bsaves?\s+(?:it|them|this|the|a|your|output)\b[^.]*\bto\b/i.test(line) ||
    /\bwrites?\b[^.]*\bto\s+(?:a\s+|the\s+|your\s+|disk|stdout|[~./])/i.test(line) ||
    /\bwrites?\s+(?:it|them|this|the|a|your|output)\b[^.]*\bfile\b/i.test(line) ||
    /\bcreates?\s+a\s+(?:new\s+)?file\b/i.test(line)
  ) {
    caps.add('writes-files');
  }

  // Reads secrets: a READ/USE action on a secret noun, not the bare noun. This
  // stops doc prose like "## With Workers AI (no API keys)", "store as secrets",
  // and "use `wrangler secret put` ... never hardcode" from flagging — none of
  // them tell the agent to READ a secret. "Trade secrets" is the legal term of
  // art (NDA/contract prose), not a credential — excluded via lookbehind.
  const secretNoun =
    /\b(?:API[\s-]?keys?|(?:access|auth|bearer|api)[\s-]?tokens?|(?<!trade[\s-])secrets?|credentials?|environment\s+variables?|env\s+vars?)\b/i;
  // Verbs that mean the skill consumes/configures a secret. Deliberately excludes
  // "use"/"store"/"generate"/"put"/"hardcode" so secret-management advice
  // ("store as secrets", "wrangler secret put", "no API keys") stays inert.
  const readsSecret =
    /\b(?:reads?|reading|loads?|loading|fetch(?:es|ing)?|gets?|getting|retrieve[sd]?|retrieving|access(?:es|ing)?|passes?|passing|injects?|injecting|supply|supplies|supplying|sets?|setting|provides?|providing|configures?|configuring|needs?|requires?|requiring|expects?|expecting)\b/i;
  if (secretNoun.test(line) && readsSecret.test(line)) {
    caps.add('reads-secrets');
  }

  if (/\bpost-?install\b/i.test(line) || /\bpre-?install\b/i.test(line) || /\binstall\s+hooks?\b/i.test(line)) {
    caps.add('install-hooks');
  }

  if (
    /\brun(?:s|ning)?\s+(?:the\s+)?(?:following\s+)?commands?\b/i.test(line) ||
    /\bexecutes?\s+the\s+(?:following\s+)?commands?\b/i.test(line) ||
    /\bin\s+(?:your|the|a)\s+terminal\b/i.test(line) ||
    /\bshell\s+commands?\b/i.test(line)
  ) {
    caps.add('runs-shell');
  }

  // Injects content into the agent's output: an inject verb followed CLOSELY by
  // an injectable noun (footer/banner/credit/…) plus an output noun on the same
  // line ("append this footer as the very last output"), OR that same verb+noun
  // joined to the output-position phrase. See INJECTS_VERB_NOUN_RE (module scope)
  // for the shared-lexicon rationale.
  if (INJECTS_VERB_NOUN_RE.test(line) && (OUTPUT_NOUN_RE.test(line) || OUTPUT_POSITION_RE.test(line))) {
    caps.add('injects-output-content');
  }

  return caps;
}

/** Pull inline-code spans (`` `...` ``) out of a prose line. */
function inlineCodeSpans(line: string): string[] {
  const spans: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) spans.push(m[1]);
  return spans;
}

/**
 * Fenced-block info-strings we treat as SHELL command blocks. Only these (and a
 * bare fence with NO info-string) have their lines classified as commands; a
 * ```js / ```python / ```text / ```json fence is documentation, not an
 * instruction to run, so its lines are NOT classified. This stops generic
 * tokens (`fetch(`, `eval(`) inside a non-shell example from inventing
 * runs-shell / network / executes-generated.
 */
const SHELL_FENCE_INFO = new Set([
  '',
  'sh',
  'bash',
  'shell',
  'console',
  'zsh',
  'shell-session',
  'shellsession',
  'sh-session',
  'terminal',
]);

/** Parse a fence marker line, returning its lowercased info-string (`''` when
 *  none), or null when the line is not a fence marker. */
function fenceInfoString(line: string): string | null {
  const m = /^\s*(?:```+|~~~+)\s*([^\s`~]*)/.exec(line);
  if (!m) return null;
  return m[1].toLowerCase();
}

/**
 * The single prose detector. Returns [] for non-markdown so the collector can
 * safely run it over every text file. Walks the markdown once, line by line,
 * tracking fenced-code-block state AND the open fence's info-string:
 *  - inside a SHELL fence (sh/bash/shell/console/zsh/none): the whole line is
 *    treated as a command,
 *  - inside a NON-shell fence (js/python/json/text/…): the line is skipped —
 *    it is a documentation example, not a command,
 *  - outside a fence: inline `code` spans are treated as commands, and the bare
 *    text is scanned for imperative prose.
 * One hit per (capability, line); line numbers are 1-indexed.
 */
function detectProseCapabilities(file: string, contents: string): Hit[] {
  if (!isMarkdown(file)) return [];

  const hits: Hit[] = [];
  const lines = contents.split('\n');
  // null = not inside a fence; otherwise the lowercased info-string of the open
  // fence (`''` for a bare ``` fence).
  let fenceInfo: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Fence open/close marker (``` or ~~~, any length). The marker line itself
    // carries no command. Toggle: capture the info-string on open, clear on close.
    const marker = fenceInfoString(line);
    if (marker !== null) {
      fenceInfo = fenceInfo === null ? marker : null;
      continue;
    }

    const caps = new Set<Capability>();
    if (fenceInfo !== null) {
      // Only shell-like fences carry runnable commands; others are examples.
      if (SHELL_FENCE_INFO.has(fenceInfo)) {
        for (const cap of classifyCommand(line)) caps.add(cap);
      }
    } else {
      for (const span of inlineCodeSpans(line)) {
        for (const cap of classifyCommand(span)) caps.add(cap);
      }
      for (const cap of classifyProse(line)) caps.add(cap);
    }

    const lineNo = i + 1;
    for (const capability of caps) {
      hits.push({ capability, lineStart: lineNo, lineEnd: lineNo });
    }
  }

  return hits;
}

/**
 * Deterministic prose capability detectors, injectable into `runCapabilityScan`.
 * Single detector; markdown-gated (returns [] for non-markdown files).
 */
export const PROSE_CAPABILITY_DETECTORS: CapabilityDetector[] = [detectProseCapabilities];
