/**
 * GitHub repo-spec parser for `skillet import <owner>/<repo>`.
 *
 * Accepts the friction-free skill.fish-style forms and the URLs people paste
 * out of a browser, normalising them all to `{ owner, repo, ref, subdir }`:
 *
 *   owner/repo
 *   owner/repo@ref                      (branch, tag, or commit sha)
 *   owner/repo/sub/dir                  (import only skills under sub/dir)
 *   owner/repo/sub/dir@ref
 *   github.com/owner/repo
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/<ref>/<subdir...>
 *
 * Like `parseSkillRef`, this runs BEFORE any value is interpolated into a
 * GitHub API URL or a filesystem path, so it doubles as the path-traversal /
 * URL-injection gate: every returned field matches a strict allowlist and is
 * safe to encode and join verbatim. `ref` and `subdir` are still URL-encoded
 * by the client, but rejecting `..` and control chars here keeps a hostile
 * spec from ever reaching the network.
 */

// GitHub owner (user or org): alphanumerics and single hyphens, no leading or
// trailing hyphen, max 39 chars.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// GitHub repo name: alphanumerics, hyphen, underscore, dot (a trailing `.git`
// is stripped before this check). Max 100 chars.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// A git ref — branch/tag/sha. Conservative: no `..`, no control chars, no
// leading/trailing slash. Slashes are allowed (e.g. `release/1.x`).
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// Control chars (and space) are never valid anywhere in a spec.
const CONTROL_RE = /[\u0000-\u0020\u007f]/;

export interface GitHubRepoSpec {
  owner: string;
  repo: string;
  /** Branch/tag/sha, or null to use the repo's default branch. */
  ref: string | null;
  /** POSIX subdirectory to scope discovery to, or null for the whole repo. */
  subdir: string | null;
}

export class GitHubSpecError extends Error {
  readonly code: "invalid_spec";
  constructor(message: string) {
    super(message);
    this.code = "invalid_spec";
    this.name = "GitHubSpecError";
  }
}

/**
 * Cheap, allocation-light check used by the CLI to decide whether an `import`
 * argument is a GitHub spec rather than a local path. Deliberately permissive:
 * it only needs to be true for things that have a slash, no whitespace, and no
 * leading `.`/`/`/`~` (which mark a local path). The authoritative validation
 * is `parseGitHubRepoSpec`; the CLI always tries a local `lstat` first, so a
 * false positive here only matters for paths that do not exist on disk.
 */
export function looksLikeGitHubSpec(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  if (/\s/.test(input)) return false;
  if (input.startsWith(".") || input.startsWith("/") || input.startsWith("~")) {
    return false;
  }
  if (/^https?:\/\//i.test(input) || input.startsWith("github.com/")) return true;
  // A bare `a/b` with no scheme: needs at least one slash and a non-empty owner.
  return /^[^/]+\/[^/]+/.test(input);
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function validateSubdir(raw: string): string {
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) {
    throw new GitHubSpecError("Subdirectory in spec is empty");
  }
  const segments = trimmed.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new GitHubSpecError(
        `Unsafe subdirectory in spec: ${JSON.stringify(raw)}`,
      );
    }
  }
  return segments.join("/");
}

function validateRef(raw: string): string {
  if (!REF_RE.test(raw) || raw.includes("..") || raw.endsWith("/")) {
    throw new GitHubSpecError(`Unsafe git ref in spec: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function finalize(
  owner: string,
  repoRaw: string,
  ref: string | null,
  subdirRaw: string | null,
): GitHubRepoSpec {
  const repo = stripGitSuffix(repoRaw);
  if (!OWNER_RE.test(owner)) {
    throw new GitHubSpecError(
      `Invalid GitHub owner ${JSON.stringify(owner)} (alphanumerics and hyphens, max 39 chars)`,
    );
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new GitHubSpecError(`Invalid GitHub repo name ${JSON.stringify(repo)}`);
  }
  return {
    owner,
    repo,
    ref: ref ? validateRef(ref) : null,
    subdir: subdirRaw != null ? validateSubdir(subdirRaw) : null,
  };
}

/**
 * Parse any supported GitHub spec form into validated, injection-safe parts.
 * Throws `GitHubSpecError` on anything outside the grammar.
 */
export function parseGitHubRepoSpec(input: string): GitHubRepoSpec {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new GitHubSpecError("GitHub spec is empty");
  }
  if (CONTROL_RE.test(input.trim())) {
    throw new GitHubSpecError(
      "GitHub spec contains whitespace or control characters",
    );
  }

  let rest = input.trim();

  // Strip a leading scheme / host so the rest is `owner/repo[/...]`.
  rest = rest.replace(/^https?:\/\//i, "");
  rest = rest.replace(/^github\.com\//i, "");
  // Reject any leftover host (e.g. a GitHub Enterprise URL we don't support).
  if (rest.includes("://") || rest.includes("@github.com")) {
    throw new GitHubSpecError(
      `Unsupported GitHub URL ${JSON.stringify(input)} — use owner/repo or a github.com URL`,
    );
  }

  // A trailing `@ref` applies to the whole spec (owner/repo or owner/repo/sub).
  let ref: string | null = null;
  const atIdx = rest.lastIndexOf("@");
  if (atIdx > 0) {
    ref = rest.slice(atIdx + 1);
    rest = rest.slice(0, atIdx);
    if (ref.length === 0) {
      throw new GitHubSpecError("GitHub spec has empty ref after '@'");
    }
  }

  const parts = rest.split("/").filter((p) => p.length > 0);
  if (parts.length < 2) {
    throw new GitHubSpecError(
      `GitHub spec ${JSON.stringify(input)} must look like "owner/repo"`,
    );
  }

  const [owner, repo, ...tail] = parts;

  // Browser "tree" URLs: owner/repo/tree/<ref>/<subdir...>. The ref segment
  // here wins over any `@ref` (you cannot have both in a tree URL anyway).
  if (tail[0] === "tree" && tail.length >= 2) {
    const treeRef = tail[1];
    const subdir = tail.slice(2).join("/");
    return finalize(owner, repo, treeRef, subdir.length > 0 ? subdir : null);
  }
  // `blob` URLs point at a file; treat its directory as the subdir scope.
  if (tail[0] === "blob" && tail.length >= 3) {
    const treeRef = tail[1];
    const filePath = tail.slice(2);
    filePath.pop(); // drop the filename, keep the directory
    const subdir = filePath.join("/");
    return finalize(owner, repo, treeRef, subdir.length > 0 ? subdir : null);
  }

  const subdir = tail.join("/");
  return finalize(owner, repo, ref, subdir.length > 0 ? subdir : null);
}
