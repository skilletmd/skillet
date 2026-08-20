/**
 * MCP tool and resource request handler.
 *
 * Tools (fixed, declarative — NOT one tool per skill):
 *   list_skills()           → kit manifest
 *   get_skill(slug)         → SKILL.md body + supporting-file resource list
 *   search_skills(query)    → keyword-matched subset of the manifest (name/description/slug)
 *
 * Resources: one per file in each skill bundle, URI skillet://{owner}/{slug}/{path}.
 *
 * Auth gate is applied by the caller before invoking any handler here.
 */

import { assertSafeSlug } from "@skillet/core";
import type {
  McpResource,
  McpResourceContent,
  McpTool,
  ToolCallResult,
  ToolResultContent,
} from "./protocol.js";
import { buildResourceList, buildUri, readResource, sourceDataToText } from "./resources.js";
import { localSkillSource, type SkillEntry, type SkillSource } from "./store.js";

/**
 * Slug refs may be owner-qualified (`@owner/slug` or `owner/slug`) — that's the
 * canonical slug the store uses and the exact string list_skills/search_skills
 * hand back, so get_skill must accept it verbatim or the tools don't compose.
 * A single leading `@` is the owner sigil, stripped for per-segment validation
 * only; the ref itself is looked up unchanged. Every traversal guard still
 * holds: no extra `/`, and each segment runs assertSafeSlug (rejects `.`,
 * `..`, empty, null bytes).
 */
function assertSafeSlugRef(ref: string): void {
  const segments = ref.replace(/^@/, "").split("/");
  if (segments.length > 2) {
    throw new Error(`Unsafe skill slug rejected: "${ref}"`);
  }
  for (const segment of segments) assertSafeSlug(segment);
}

// ── Tool definitions ─────────────────────────────────────────────────────────

/** Shape of one manifest entry — shared by list_skills/search_skills output. */
const MANIFEST_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    version_hash: { type: "string" },
    version_label: { type: ["string", "null"] },
    author: { type: ["string", "null"] },
  },
  required: ["slug", "name", "description", "version_hash"],
};

/** outputSchema for list_skills/search_skills: `{ skills: ManifestItem[] }`. */
const MANIFEST_OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: { skills: { type: "array", items: MANIFEST_ITEM_SCHEMA } },
  required: ["skills"],
};

/**
 * Every Skillet tool only reads the user's kit — none mutate, delete, or reach
 * beyond the kit. Declaring this stops write-cautious clients (ChatGPT) from
 * tagging the tools DESTRUCTIVE / PUBLIC WRITE and prompting on every call.
 */
const READ_ONLY: McpTool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOLS: McpTool[] = [
  {
    name: "list_skills",
    title: "List skills",
    description:
      "List all skills available in this Skillet kit. Returns slug, name, description, version hash, and author for each skill.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: MANIFEST_OUTPUT_SCHEMA,
    annotations: READ_ONLY,
  },
  {
    name: "get_skill",
    title: "Get skill",
    description:
      "Get a skill's full SKILL.md content and the list of its supporting-file resource URIs.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The skill slug (e.g. festival-ops)" },
      },
      required: ["slug"],
    },
    annotations: READ_ONLY,
    outputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        version_hash: { type: "string" },
        version_label: { type: ["string", "null"] },
        author: { type: ["string", "null"] },
        skill_md: { type: ["string", "null"] },
        resources: { type: "array", items: { type: "string" } },
      },
      required: ["slug", "name", "description", "version_hash", "skill_md", "resources"],
    },
  },
  {
    name: "search_skills",
    title: "Search skills",
    description:
      "Search skills by keyword. Matches against skill name, description, and slug. Returns the same fields as list_skills.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
      },
      required: ["query"],
    },
    outputSchema: MANIFEST_OUTPUT_SCHEMA,
    annotations: READ_ONLY,
  },
];

// ── Tool call implementations ────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: unknown,
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<ToolCallResult> {
  // `structuredContent` (2025-06-18+) mirrors the JSON in the text block so
  // schema-aware clients skip re-parsing and tool-UI hosts can render from it.
  // The text bytes are unchanged from before — existing clients see no diff.
  switch (name) {
    case "list_skills": {
      const manifest = buildManifest(skills);
      return {
        content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
        structuredContent: { skills: manifest },
      };
    }
    case "get_skill": {
      const slug = extractString(args, "slug");
      assertSafeSlugRef(slug);
      const skill = skills.find((s) => s.slug === slug);
      if (!skill) {
        return {
          content: [{ type: "text", text: `Skill not found: ${slug}` }],
          isError: true,
        };
      }
      const body = await source.readFile(slug, "SKILL.md");
      const files = await listSupportingFiles(skill, source);
      const result = {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        version_hash: skill.hash,
        version_label: skill.versionLabel ?? null,
        author: skill.owner ?? null,
        skill_md: body === null ? null : sourceDataToText(body),
        resources: files,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
    case "search_skills": {
      const query = extractString(args, "query").toLowerCase();
      const matched = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          (s.description ?? "").toLowerCase().includes(query) ||
          s.slug.toLowerCase().includes(query),
      );
      const manifest = buildManifest(matched);
      return {
        content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
        structuredContent: { skills: manifest },
      };
    }
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

// ── Deep-research alias tools (opt-in; hosted transport only) ────────────────
//
// ChatGPT deep-research mode calls a fixed `search`/`fetch` tool pair (OpenAI
// deep-research MCP contract). These aliases expose the same kit data through
// that contract. They are ONLY advertised/callable when
// `McpServerOptions.deepResearchAliases` is set — the local stdio/loopback
// paths never set it, so the local tool surface stays exactly the three core
// tools above (R15).

export const DEEP_RESEARCH_TOOLS: McpTool[] = [
  {
    name: "search",
    description:
      "Alias of search_skills for OpenAI deep-research clients. Search skills by keyword (name, description, or slug). Returns { results: [{ id, title, url }] }. Pass a result id to fetch to retrieve the full skill document.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
      },
      required: ["query"],
    },
    annotations: READ_ONLY,
  },
  {
    name: "fetch",
    description:
      "Alias of get_skill for OpenAI deep-research clients. Fetch the full document for a skill id returned by search. Returns { id, title, text, url, metadata } where text is the SKILL.md body.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill id in owner/slug form (as returned by search)" },
      },
      required: ["id"],
    },
    annotations: READ_ONLY,
  },
];

export function isDeepResearchTool(name: string): name is "search" | "fetch" {
  return name === "search" || name === "fetch";
}

export type DeepResearchOutcome =
  | { ok: true; content: ToolResultContent[] }
  | { ok: false; message: string };

export async function callDeepResearchTool(
  name: "search" | "fetch",
  args: unknown,
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<DeepResearchOutcome> {
  if (name === "search") {
    const query = extractString(args, "query").toLowerCase();
    // Same matcher as search_skills: name, description, or slug substring.
    const matched = skills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.description ?? "").toLowerCase().includes(query) ||
        s.slug.toLowerCase().includes(query),
    );
    const results = matched.map((s) => ({
      id: skillId(s),
      title: s.name,
      url: skillPageUrl(s),
    }));
    return {
      ok: true,
      content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
    };
  }

  const id = extractString(args, "id");
  const skill = skills.find((s) => skillId(s) === id);
  if (!skill) {
    return { ok: false, message: `Unknown skill id: ${id}` };
  }
  assertSafeSlugRef(skill.slug);
  const body = await source.readFile(skill.slug, "SKILL.md");
  const doc = {
    id,
    title: skill.name,
    text: body === null ? "" : sourceDataToText(body),
    url: skillPageUrl(skill),
    metadata: {
      slug: skill.slug,
      description: skill.description,
      version_hash: skill.hash,
      version_label: skill.versionLabel ?? null,
      author: skill.owner ?? null,
    },
  };
  return {
    ok: true,
    content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
  };
}

/** `owner/slug` document id; `_local` owner fallback matches resource URIs. */
function skillId(s: SkillEntry): string {
  return `${s.owner ?? "_local"}/${s.slug}`;
}

/** Web base for skill page URLs — same env + default as the CLI's webBaseUrl. */
function webBaseUrl(): string {
  return (process.env["SKILLET_WEB_URL"] ?? "https://skillet.md").replace(/\/+$/, "");
}

function skillPageUrl(s: SkillEntry): string {
  return `${webBaseUrl()}/${s.owner ?? "_local"}/${s.slug}`;
}

// ── Resource handlers ─────────────────────────────────────────────────────────

export async function listResources(
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<McpResource[]> {
  return buildResourceList(skills, source);
}

export async function handleReadResource(
  uri: string,
  skills: SkillEntry[],
  source: SkillSource = localSkillSource,
): Promise<McpResourceContent | null> {
  return readResource(uri, skills, source);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildManifest(
  skills: SkillEntry[],
): Array<{
  slug: string;
  name: string;
  description: string;
  version_hash: string;
  version_label: string | null;
  author: string | null;
}> {
  return skills.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    version_hash: s.hash,
    version_label: s.versionLabel ?? null,
    author: s.owner ?? null,
  }));
}

async function listSupportingFiles(skill: SkillEntry, source: SkillSource): Promise<string[]> {
  const files = await source.listFiles(skill.slug).catch(() => [] as string[]);
  return files.map((f) => buildUri(skill.owner, skill.slug, f));
}

function extractString(args: unknown, key: string): string {
  if (args === null || typeof args !== "object") {
    throw new Error(`Missing required parameter: ${key}`);
  }
  const val = (args as Record<string, unknown>)[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`Parameter "${key}" must be a non-empty string`);
  }
  return val;
}
