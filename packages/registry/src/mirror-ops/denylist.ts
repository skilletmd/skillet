// scripts/mirror-denylist.json — the operator kill switch for mirrored repos.
// The denylist is authoritative across ALL THREE nightly phases: a denylisted
// key is skipped by the seed re-sync (phase 1), excluded from the discovered
// re-sync (phase 2), and never proposed by discovery (phase 3).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRepoKey } from '../lib/mirror-screen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load the denylist → Map of normalized repo key → reason. Missing file or
 *  empty list is a no-op. */
export function loadDenylist(filePath?: string): Map<string, string> {
    const map = new Map<string, string>();
    let raw: string;
    try {
        // src/mirror-ops and dist/mirror-ops are both two levels below the
        // package root, so ../../scripts resolves from either.
        raw = readFileSync(filePath ?? join(__dirname, '../../scripts/mirror-denylist.json'), 'utf8');
    }
    catch {
        return map;
    }
    const parsed = JSON.parse(raw) as { deny?: Array<{ repo?: string; reason?: string }> };
    for (const entry of parsed.deny ?? []) {
        const key = entry.repo ? normalizeRepoKey(entry.repo) : null;
        if (key)
            map.set(key, entry.reason ?? 'denylisted');
    }
    return map;
}
