/**
 * Parse a kit permalink handle (`@owner/slug` or `owner/slug`) before it is
 * interpolated into registry URLs.
 */
const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CONTROL_RE = /[\u0000-\u0020\u007f]/;

export class KitHandleError extends Error {
  readonly code = 'invalid_kit_handle' as const;
  constructor(message: string) {
    super(message);
    this.name = 'KitHandleError';
  }
}

export interface KitHandle {
  owner: string;
  slug: string;
  /** Normalised `@owner/slug` form. */
  canonical: string;
}

function validateSegment(label: string, value: string): void {
  if (!value || CONTROL_RE.test(value)) {
    throw new KitHandleError(`Invalid kit ${label}.`);
  }
  if (!SEGMENT_RE.test(value)) {
    throw new KitHandleError(
      `Invalid kit ${label}: use lowercase letters, numbers, and hyphens only.`,
    );
  }
}

/** Parse `@owner/kit-slug` or `owner/kit-slug`. */
export function parseKitHandle(input: string): KitHandle {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new KitHandleError('Kit handle is required (e.g. @owner/my-kit).');
  }
  const raw = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) {
    throw new KitHandleError('Kit handle must be owner/slug (e.g. @owner/my-kit).');
  }
  const owner = raw.slice(0, slash);
  const slug = raw.slice(slash + 1);
  if (raw.includes('/', slash + 1)) {
    throw new KitHandleError('Kit handle must be exactly owner/slug.');
  }
  validateSegment('owner', owner);
  validateSegment('slug', slug);
  return { owner, slug, canonical: `@${owner}/${slug}` };
}
