import matter from 'gray-matter';
import { SKILL_ENTRYPOINT, type DecodedBundle } from '@skillet/protocol';

// The packer lives in @skillet/protocol so the server (registry download
// endpoint) and the client (CLI export) share one implementation without the
// registry depending on @skillet/core. Re-export it through core's bundle barrel
// so callers have a single import surface alongside the other bundle helpers.
export { bundleToZip, bundlesToZip } from '@skillet/protocol';

/**
 * Return SKILL.md frontmatter keys beyond `name`/`description`.
 *
 * Codex and ChatGPT Skills accept `name` and `description` only ("Do not
 * include any other fields"). Export uses this to warn — never to rewrite — so
 * the author can decide whether a skill bound for a strict consumer needs
 * trimming. An empty array means the skill is clean. This stays in core (not
 * protocol) because it depends on gray-matter, a client-side concern.
 */
export function frontmatterCompatWarnings(bundle: DecodedBundle): string[] {
  const raw = bundle.get(SKILL_ENTRYPOINT);
  if (!raw) return [];
  let data: Record<string, unknown>;
  try {
    data = (matter(Buffer.from(raw).toString('utf8')).data ?? {}) as Record<
      string,
      unknown
    >;
  } catch {
    return [];
  }
  return Object.keys(data).filter((k) => k !== 'name' && k !== 'description');
}
