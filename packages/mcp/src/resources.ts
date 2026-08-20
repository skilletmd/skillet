/**
 * Skillet MCP resource model.
 *
 * Resource URI scheme:  skillet://{owner}/{slug}/{path}
 *   owner  — author handle (without `@`), or `_local` for unowned imports.
 *   slug   — skill slug (validated by assertSafeSlug).
 *   path   — POSIX-relative bundle path (e.g. `SKILL.md`, `references/policy.md`).
 *
 * SKILL.md is the headline resource; all other bundle files are siblings.
 * URIs are path-escape safe: `..` and absolute paths are rejected.
 */

import { Buffer } from "node:buffer";
import { assertSafeSlug } from "@skillet/core";
import type { McpResource, McpResourceContent } from "./protocol.js";
import { localSkillSource, type SkillEntry, type SkillSource } from "./store.js";

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SAFE_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/;

/** Canonical owner segment: normalise null/undefined → `_local`, strip leading `@`. */
export function ownerSegment(owner: string | null | undefined): string {
  if (!owner) return "_local";
  return owner.startsWith("@") ? owner.slice(1) : owner;
}

/** Build a `skillet://` resource URI for a skill file. */
export function buildUri(owner: string | null | undefined, slug: string, path: string): string {
  return `skillet://${ownerSegment(owner)}/${slug}/${path}`;
}

export interface ParsedUri {
  owner: string;   // owner segment (may be `_local`)
  slug: string;
  path: string;   // POSIX-relative bundle path
}

/**
 * Parse and validate a `skillet://` resource URI.
 * Throws on malformed, path-escape, or unsafe slug/path.
 */
export function parseUri(uri: string): ParsedUri {
  const prefix = "skillet://";
  if (!uri.startsWith(prefix)) {
    throw new Error(`Invalid Skillet resource URI: expected "skillet://" scheme`);
  }
  const rest = uri.slice(prefix.length);
  const firstSlash = rest.indexOf("/");
  if (firstSlash < 1) throw new Error(`URI missing owner segment: "${uri}"`);
  const owner = rest.slice(0, firstSlash);
  const afterOwner = rest.slice(firstSlash + 1);

  const secondSlash = afterOwner.indexOf("/");
  if (secondSlash < 1) throw new Error(`URI missing slug segment: "${uri}"`);
  const slug = afterOwner.slice(0, secondSlash);
  const path = afterOwner.slice(secondSlash + 1);

  if (!SAFE_SEGMENT_RE.test(owner) && owner !== "_local") {
    throw new Error(`URI owner segment contains unsafe characters: "${owner}"`);
  }
  assertSafeSlug(slug);
  validateBundlePath(path);

  return { owner, slug, path };
}

/** Reject paths with `..`, null bytes, absolute paths, or unsafe chars. */
function validateBundlePath(path: string): void {
  if (!path || path.length === 0) throw new Error("Resource path is empty");
  if (path.includes("\x00")) throw new Error(`Null byte in resource path`);
  if (path.startsWith("/")) throw new Error(`Absolute resource path rejected: "${path}"`);
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error(`Path traversal rejected in resource URI: "${path}"`);
    }
    if (seg.length === 0) throw new Error(`Empty path segment in resource URI: "${path}"`);
  }
  if (!SAFE_PATH_RE.test(path)) {
    throw new Error(`Unsafe characters in resource path: "${path}"`);
  }
}

function mimeType(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  if (path.endsWith(".toml")) return "application/toml";
  if (path.endsWith(".txt")) return "text/plain";
  if (path.endsWith(".py")) return "text/x-python";
  if (path.endsWith(".ts")) return "text/typescript";
  if (path.endsWith(".js")) return "text/javascript";
  return "application/octet-stream";
}

/** UTF-8 text for source data that may be a string or raw bytes. */
export function sourceDataToText(data: Uint8Array | string): string {
  return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
}

/** Base64 for source data that may be a string or raw bytes. */
function sourceDataToBase64(data: Uint8Array | string): string {
  return typeof data === "string"
    ? Buffer.from(data, "utf8").toString("base64")
    : Buffer.from(data).toString("base64");
}

/** Build the full resource list for all visible skills. */
export async function buildResourceList(
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<McpResource[]> {
  const out: McpResource[] = [];
  for (const skill of skills) {
    const files = await source.listFiles(skill.slug).catch(() => [] as string[]);
    for (const f of files) {
      out.push({
        uri: buildUri(skill.owner, skill.slug, f),
        name: `${skill.slug}: ${f}`,
        description: f === "SKILL.md" ? skill.description || undefined : undefined,
        mimeType: mimeType(f),
      });
    }
  }
  return out;
}

/** Read a resource by URI. Returns null if the skill or file is not in `visibleSkills`. */
export async function readResource(
  uri: string,
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<McpResourceContent | null> {
  // parseUri validates slug + path (traversal, null bytes, absolute paths)
  // BEFORE any source.readFile call — this applies to injected sources too.
  let parsed: ParsedUri;
  try {
    parsed = parseUri(uri);
  } catch {
    return null;
  }

  const skill = skills.find(
    (s) => s.slug === parsed.slug && ownerSegment(s.owner) === parsed.owner,
  );
  if (!skill) return null;

  const data = await source.readFile(skill.slug, parsed.path);
  if (data === null) return null;

  const mime = mimeType(parsed.path);
  const isText = mime.startsWith("text/") || mime === "application/json"
    || mime === "application/yaml" || mime === "application/toml";

  if (isText) {
    return { uri, mimeType: mime, text: sourceDataToText(data) };
  }
  return { uri, mimeType: mime, blob: sourceDataToBase64(data) };
}
