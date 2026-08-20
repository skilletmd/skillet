/**
 * Minimal, dependency-free GitHub source client for `skillet import owner/repo`.
 *
 * v1 is intentionally PUBLIC-ONLY and unauthenticated — no token is read,
 * stored, or sent. This keeps the import path off the credential-handling
 * surface entirely (the spec defers auth until publish) and means a private or
 * nonexistent repo surfaces the same clean 404 we turn into a friendly error.
 *
 * Two GitHub hosts are used:
 *   - api.github.com    repo metadata + the recursive git tree (2 calls total,
 *                       well inside the 60 req/hr unauthenticated budget).
 *   - raw.githubusercontent.com    file bytes (no API rate limit).
 *
 * fetch is injectable (`fetchImpl`) so the import flow is fully testable with
 * no network — the same pattern the registry client uses.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const USER_AGENT = "skillet-cli";

const API_HEADERS: Record<string, string> = {
  accept: "application/vnd.github+json",
  "user-agent": USER_AGENT,
  "x-github-api-version": "2022-11-28",
};

export type GitHubErrorCode =
  | "not_found"
  | "rate_limited"
  | "http_error"
  | "network_error"
  | "fetch_failed";

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status?: number;
  constructor(code: GitHubErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    if (status != null) this.status = status;
    this.name = "GitHubError";
  }
}

/** A single blob (file) entry from the recursive git tree. */
export interface TreeBlob {
  /** POSIX path from the repo root. */
  path: string;
  /** Size in bytes as reported by the tree API (0 if unknown). */
  size: number;
}

export interface RepoMeta {
  defaultBranch: string;
  private: boolean;
}

export interface GitHubSourceOptions {
  /** Inject an alternate fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export class GitHubSource {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GitHubSourceOptions = {}) {
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new GitHubError(
        "network_error",
        "No fetch implementation available (Node >=18 or inject fetchImpl).",
      );
    }
    this.fetchImpl = f;
  }

  private async call(url: string, headers: Record<string, string>): Promise<Response> {
    try {
      return await this.fetchImpl(url, { headers });
    } catch (err) {
      throw new GitHubError(
        "network_error",
        `Network error reaching GitHub: ${(err as Error).message}`,
      );
    }
  }

  /** Map a 403 either to a rate-limit error or a generic HTTP error. */
  private rateLimitOrHttp(res: Response, context: string): GitHubError {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 403 && remaining === "0") {
      return new GitHubError(
        "rate_limited",
        "GitHub rate limit reached for anonymous requests. Try again later.",
        403,
      );
    }
    return new GitHubError("http_error", `${context} (HTTP ${res.status}).`, res.status);
  }

  /**
   * Repo metadata. A 404 here is the authoritative "private or nonexistent"
   * signal for unauthenticated callers — GitHub returns 404 (not 403) for
   * private repos to avoid leaking their existence.
   */
  async getRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
    const res = await this.call(`${GITHUB_API}/repos/${owner}/${repo}`, API_HEADERS);
    if (res.status === 404) {
      throw new GitHubError(
        "not_found",
        `Repository ${owner}/${repo} not found. It may be private — only public repos are supported (auth is deferred until publish).`,
        404,
      );
    }
    if (!res.ok) throw this.rateLimitOrHttp(res, `Could not read ${owner}/${repo}`);
    const body = (await res.json()) as { default_branch?: string; private?: boolean };
    return {
      defaultBranch: body.default_branch ?? "main",
      private: body.private === true,
    };
  }

  /**
   * The full recursive git tree at `ref`. Returns only blobs (files); trees
   * and submodule `commit` entries are dropped. `truncated` is GitHub's signal
   * that the repo exceeded its tree-listing cap and the result is partial.
   */
  async listTree(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ blobs: TreeBlob[]; truncated: boolean }> {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const res = await this.call(url, API_HEADERS);
    if (res.status === 404) {
      throw new GitHubError(
        "not_found",
        `Ref "${ref}" not found in ${owner}/${repo}.`,
        404,
      );
    }
    if (!res.ok) throw this.rateLimitOrHttp(res, `Could not list ${owner}/${repo}@${ref}`);
    const body = (await res.json()) as {
      tree?: Array<{ path?: string; type?: string; size?: number }>;
      truncated?: boolean;
    };
    const blobs: TreeBlob[] = [];
    for (const t of body.tree ?? []) {
      if (t.type === "blob" && typeof t.path === "string") {
        blobs.push({ path: t.path, size: typeof t.size === "number" ? t.size : 0 });
      }
    }
    return { blobs, truncated: body.truncated === true };
  }

  /** Raw bytes of one file at `ref`. Path segments are individually encoded. */
  async fetchBlob(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<Uint8Array> {
    const encPath = path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    const url = `${GITHUB_RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${encPath}`;
    const res = await this.call(url, { "user-agent": USER_AGENT });
    if (!res.ok) {
      throw new GitHubError(
        "fetch_failed",
        `Failed to download ${path} from ${owner}/${repo}@${ref} (HTTP ${res.status}).`,
        res.status,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
