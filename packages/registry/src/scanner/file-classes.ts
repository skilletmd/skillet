// Single source of truth for the scanner's FILE CLASSIFICATION taxonomy.
//
// "Which extensions are markdown/prose, which are code/scripts, which are inert
// data/doc/media, which carry a capability detector" used to live in four
// separate, subtly-different regexes across text-files.ts, capabilities/
// collector.ts, detectors/capability/prose-detectors.ts, and detectors/util.ts. They
// drifted (e.g. `.mdc` was in none, `.markdown` only in the inert list). This
// module is the ONE place that owns them.
//
// To extend scanner coverage — add a language, recognize a new markdown variant,
// classify a new doc format — edit the SET that matches and every call site
// picks it up. Predicates are pure (no IO, no state), mirroring the detector
// purity contract, so this is safe to import anywhere in the scanner.

/** Markdown / instruction-prose surface. The prose detectors run here; code
 *  detectors skip it. THE set to edit when recognizing a new markdown variant.
 *  Includes `.mdc` (Cursor "Project Rules") and `.markdown` — both are markdown
 *  instruction surfaces and must be scanned, not flagged as unscanned blind spots. */
export const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.mdc', '.markdown']);

/** Code files a capability detector actually inspects (mirrors code-detectors.ts:
 *  JS/TS incl. .mts/.cts, Python, shells, Swift). Markdown is covered separately via the
 *  prose detectors; see {@link isCoveredByDetector}. */
export const CODE_DETECTOR_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx',
  '.py', '.sh', '.bash', '.zsh', '.ksh',
  '.swift',
]);

/** Basenames a capability detector inspects (package manifests). */
export const COVERED_BASENAMES = new Set(['package.json']);

/** Executable/script source — the threat detectors' code-vs-prose split (a grep
 *  example inside a `.md` is documentation, not a real call). Broader than the
 *  capability code set: includes languages with no capability detector yet. */
export const SCRIPT_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
]);

/** Text-input extensions (scanner reads these; everything else falls back to a
 *  UTF-8/printable heuristic in isTextFile). */
export const TEXT_EXTENSIONS = new Set([
  // Docs / instruction surfaces
  '.md', '.mdx', '.mdc', '.markdown', '.txt',
  // Agent / skill definitions
  '.skill', '.agent',
  // Scripts
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  // Source
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  // Config
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env', '.cfg', '.conf',
  // Web
  '.html', '.htm', '.css', '.scss',
  // LaTeX — NOT inert: `\write18` shell-escape is a real code-exec vector.
  '.tex', '.sty', '.cls', '.dtx', '.ltx',
]);

/** LaTeX source — read as text and inspected by the LaTeX threat detector for
 *  shell-escape (`\write18`), piped `\input`, and LuaTeX `\directlua` exec. */
export const LATEX_EXTENSIONS = new Set(['.tex', '.sty', '.cls', '.dtx', '.ltx']);

/** True for a LaTeX source file (a real, if narrow, code-execution surface). */
export function isLatexFile(path: string): boolean {
  return LATEX_EXTENSIONS.has(extOf(path));
}

/** Extensionless / fixed-name text files. */
export const TEXT_BASENAMES = new Set([
  'Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Rakefile',
  '.gitignore', '.dockerignore', '.editorconfig', '.npmrc',
  'CHANGELOG', 'LICENSE', 'README',
]);

/** Clearly-inert data / doc / media shapes: a zero-hit file matching this is a
 *  genuine "nothing here", NOT an un-inspected blind spot. Conservative — anything
 *  NOT here and not covered is treated as a potential blind spot. Kept as a regex
 *  because it encodes ranges (`mp[0-9]`, `ya?ml`, `html?`, `tiff?`, `woff2?`). */
export const INERT_EXTENSION_RE =
  /\.(?:md|mdx|markdown|txt|text|rst|adoc|json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|env|csv|tsv|lock|xml|html?|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic|pdf|woff2?|ttf|otf|eot|mp[0-9]|m4a|wav|ogg|flac|webm|mov|avi|mkv|zip|gz|tgz|tar|bz2|xz|7z|rar|wasm|map|csl|bib|mplstyle|bst|cbx|bbx|lbx)$/i;

/** Fixed-name inert files (licenses, changelogs, dotfiles). */
export const INERT_BASENAME_RE =
  /^(?:LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE|README|CHANGELOG|CHANGES|HISTORY|AUTHORS|CONTRIBUTORS|CONTRIBUTING|CODEOWNERS|VERSION|\.gitignore|\.gitattributes|\.npmignore|\.dockerignore|\.editorconfig|\.prettierrc|\.eslintrc|\.npmrc|\.nvmrc)$/i;

/** Final path segment. */
export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Template-wrapper suffixes, transparent for classification: `SKILL.md.tmpl`
 *  is a template OF markdown and carries the same instruction payload as the
 *  markdown it generates, so it must be classified (and scanned) by the inner
 *  extension — not parked as an "unscanned" blind spot. A bare `foo.tmpl`
 *  (no inner extension) still classifies as unknown shape → blind spot. */
const TEMPLATE_SUFFIX_RE = /\.(?:tmpl|template|tpl)$/i;

/** Lowercased extension WITH the dot (e.g. `.md`), or `''` for none/dotfile.
 *  A trailing template suffix is stripped first, so `.md.tmpl` reads `.md`. */
export function extOf(path: string): string {
  const b = basename(path).replace(TEMPLATE_SUFFIX_RE, '');
  const dot = b.lastIndexOf('.');
  return dot <= 0 ? '' : b.slice(dot).toLowerCase();
}

/** Markdown / prose surface (prose detectors run; code detectors skip). */
export function isMarkdownFile(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extOf(path));
}

/** Executable/script source (threat code-vs-prose split). */
export function isScriptFile(path: string): boolean {
  return SCRIPT_EXTENSIONS.has(extOf(path));
}

/** Extensionless executable script: first line is a shebang, not markdown prose. */
export function hasShebangLine(contents: string): boolean {
  const first = contents.split(/\r?\n/, 1)[0] ?? '';
  return first.trimStart().startsWith('#!');
}

/** Extensionless path with a shebang (e.g. `bin/install`) — threat script surface. */
export function isShebangScript(path: string, contents: string): boolean {
  if (!hasShebangLine(contents)) return false;
  if (isMarkdownFile(path)) return false;
  if (extOf(path) !== '') return false;
  const base = basename(path);
  if (!base || base === 'SKILL.md') return false;
  return true;
}

/** Map a shebang interpreter to the language extension the detectors dispatch on.
 *  Extensionless scripts (`scripts/pr-snapshot`, `bin/install`) declare their
 *  language in the `#!` line, not a filename suffix, so language-keyed detectors
 *  and blind-spot coverage would otherwise skip them. Recognizes the common
 *  interpreters; an unknown one returns null so the file stays an honest blind
 *  spot rather than a falsely-covered one. */
export function shebangInterpreterExt(contents: string): '.py' | '.sh' | '.js' | null {
  if (!hasShebangLine(contents)) return null;
  const first = contents.split(/\r?\n/, 1)[0]!;
  if (/\bpython[0-9.]*\b/.test(first)) return '.py';
  if (/\b(?:bash|sh|zsh|ksh|dash)\b/.test(first)) return '.sh';
  if (/\bnode\b/.test(first)) return '.js';
  return null;
}

/** Classification handle for a bundle entry: the real path, except an
 *  OTHERWISE-UNCOVERED extensionless shebang script resolves to
 *  `<path><interpreter-ext>` so the language-keyed detectors and blind-spot
 *  coverage treat it like the script it is. Files a detector already covers
 *  (markdown, instruction paths, extensioned scripts, manifests) are returned
 *  unchanged, so this only ever ADDS coverage, never re-routes an existing
 *  classification. The suffix is for CLASSIFICATION ONLY; every finding, hit,
 *  and blind-spot path reported to callers keeps the real filename. */
export function effectiveScriptPath(path: string, contents: string): string {
  if (isCoveredByDetector(path)) return path;
  if (!isShebangScript(path, contents)) return path;
  const ext = shebangInterpreterExt(contents);
  return ext ? path + ext : path;
}


/** True when SOME registered detector inspects this file — a capability code
 *  detector, a package manifest, or the markdown prose detectors. */
export function isCoveredByDetector(path: string): boolean {
  return (
    isMarkdownFile(path) ||
    isExtensionlessInstructionPath(path) ||
    isLatexFile(path) ||
    CODE_DETECTOR_EXTENSIONS.has(extOf(path)) ||
    COVERED_BASENAMES.has(basename(path))
  );
}

/** Extensionless instruction-shaped paths under agents/ or references/. */
export function isExtensionlessInstructionPath(path: string): boolean {
  if (extOf(path) !== '') return false;
  const base = basename(path);
  if (!base || base === 'SKILL.md') return false;
  return path.startsWith('agents/') || path.startsWith('references/');
}

/** True for clearly-inert data/doc/media files (safe to read empty as "inert").
 *  Template suffixes are transparent here too (`config.yaml.template` is inert),
 *  matching the {@link extOf} rule. */
export function isInertShape(path: string): boolean {
  return (
    INERT_EXTENSION_RE.test(basename(path).replace(TEMPLATE_SUFFIX_RE, '')) ||
    INERT_BASENAME_RE.test(basename(path))
  );
}

/** True when the extension/basename is on the text allowlist (callers still run
 *  the UTF-8 heuristic for everything else). */
export function isTextExtension(path: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(path)) || TEXT_BASENAMES.has(basename(path));
}
