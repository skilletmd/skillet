import { stripControlChars } from "./sanitize-output.js";
import { webBaseUrl } from "./cli-command-tier.js";

export interface RenderedError {
  /** What happened, in words a person can act on. */
  line: string;
  /** The one next action, when a real one exists. */
  next?: string;
}

/** Truncate raw content hashes so they stop dominating error lines. */
function shortenHashes(text: string): string {
  return text.replace(/sha256:([0-9a-f]{8})[0-9a-f]{56}/gi, "sha256:$1…");
}

const KNOWN: Array<{ match: RegExp; render: (raw: string) => RenderedError }> = [
  {
    match: /^signature_invalid|signature key_id|does not match author_pub|hashed to sha256/i,
    render: () => ({
      line: "This skill's content doesn't match its author's signature, so Skillet refused it to protect you.",
      next: "If this keeps happening, remove and re-add the skill, or check with its author.",
    }),
  },
  {
    match: /^rollback_detected/i,
    render: () => ({
      line: "The registry offered an OLDER version than the one you already have, which can hide a fix. Skillet kept your newer copy.",
      next: "If the author intentionally rolled back, remove and re-add the skill to accept it.",
    }),
  },
  {
    match: /^manifest_empty/i,
    render: () => ({
      line: "The registry answered but sent no skill data.",
      next: "Usually temporary. Run `skillet sync` again in a moment.",
    }),
  },
  {
    match: /^registry_missing/i,
    render: () => ({
      line: "This skill has lost its registry link, so updates can't be pulled.",
      next: "Re-add it to repair: `skillet add <ref>`.",
    }),
  },
  {
    match: /is yanked/i,
    render: () => ({
      line: "The author pulled this version, so Skillet won't install it.",
      next: "A newer version will install normally when it's published.",
    }),
  },
  {
    match: /is unsigned|has not registered a signing key/i,
    render: () => ({
      line: "This skill isn't signed by its author yet, so Skillet can't verify who wrote it.",
      next: "Ask the author to publish a signed version.",
    }),
  },
  {
    match: /http_401|http_403|HTTP 401|HTTP 403|unauthorized/i,
    render: () => ({
      line: "The registry didn't accept this machine's credentials.",
      next: "Reconnect with a fresh code: `skillet connect <code>` (get one at " + `${webBaseUrl()}/settings).`,
    }),
  },
  {
    match: /http_5\d\d|HTTP 5\d\d/i,
    render: () => ({
      line: "The registry had a problem on its end.",
      next: "Try again in a minute; if it persists, check " + `${webBaseUrl()} for status.`,
    }),
  },
  {
    match: /http_404|HTTP 404/i,
    render: () => ({
      line: "The registry doesn't have what this command asked for. It may have been removed or renamed.",
    }),
  },
  {
    match: /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i,
    render: () => ({
      line: "The registry couldn't be reached. Check your connection.",
      next: "Everything already synced keeps working offline; run `skillet sync` when you're back.",
    }),
  },
];

/**
 * One human rendering for every error the CLI shows (KTD3). Known internal
 * codes become a plain sentence plus the one next action; unknown text is
 * cleaned (control characters stripped — registry-supplied text is a trust
 * boundary — and hashes shortened) rather than dumped raw. Core keeps
 * throwing coded errors; only the presentation lives here.
 */
export function renderError(reasonOrError: string | Error): RenderedError {
  const raw =
    typeof reasonOrError === "string"
      ? reasonOrError
      : (reasonOrError?.message ?? String(reasonOrError));
  const safe = stripControlChars(raw);
  for (const { match, render } of KNOWN) {
    if (match.test(safe)) {
      const rendered = render(safe);
      return { line: stripControlChars(rendered.line), ...(rendered.next ? { next: stripControlChars(rendered.next) } : {}) };
    }
  }
  // Unknown: clean, shorten, and strip a leading KNOWN internal code prefix
  // (never an arbitrary `word:` prefix — that would eat slugs and filenames).
  const cleaned = shortenHashes(safe).replace(
    /^(pull_failed|integrity_failed|union_pull_failed|materialize_failed|edit_unreadable|quarantined|http_\d+):\s+/,
    "",
  );
  return { line: cleaned || "Something went wrong, and the error carried no details." };
}

/** Convenience: the rendered error as one or two printable lines. */
export function renderErrorLines(reasonOrError: string | Error): string[] {
  const { line, next } = renderError(reasonOrError);
  return next ? [line, `  ${next}`] : [line];
}

/**
 * Print a rendered error: the first line through `decorate` (fail(), a
 * prefix template, …), follow-up action lines plain. One printer instead of
 * the destructure-and-loop repeated at every call site.
 */
export function printRenderedError(
  reasonOrError: string | Error,
  decorate: (line: string) => string = (l) => l,
  print: (line: string) => void = console.error,
): void {
  const [what, ...next] = renderErrorLines(reasonOrError);
  print(decorate(what));
  for (const n of next) print(n);
}
