# Detectors

Two families of detector live here. They answer different questions, so they stay in separate subdirs.

- **`threat/`** — produces **flags**. Each file is one category (injection, exfil, destructive, …) and reports findings when content looks harmful.
- **`capability/`** — produces **permissions**. Reports what a skill *can do* (runs shell, network, deletes files, …) regardless of intent.
- **`ast/`** — shared call-site parsing (JavaScript + Python) used by both `threat/risky-call.ts` and `capability/code-detectors.ts`. Lives at this parent level because it belongs to neither family alone.
- **`util.ts`** — shared helpers (`runPattern`, `lineNumber`, `snippetAround`, file-class re-exports). Parent level for the same reason: both families import it.

## Adding a detector

**Threat:** add a new category file in `threat/` exporting a `Detector`, with a local `PATTERNS` array of `{ category, detector, pattern, … }` entries. Register it in `../scanner.ts`. The category string must be in the `Category` union (`../../types.ts`).

The inventory builder parses every `*.ts` in `threat/` for `category:` / `detector:` literals, so a new file is auto-discovered. After adding one, regenerate the committed manifest:

```
pnpm --filter @skillet/registry scan:inventory
```

Bumping the threat detector set also requires bumping `DETECTOR_CORPUS_VERSION` (`../cache.ts`) so already-cached scans re-run against the new corpus — guarded by `tests/corpus-version-guard.test.ts`, which fails if the detector set changes without the version + fingerprint moving.

**Capability:** add an entry to `capability/code-detectors.ts` (code/AST signals), `capability/prose-detectors.ts` (markdown/prose signals), or `capability/config-detectors.ts` (structured-config signals, e.g. an MCP server declared in `mcp.json`). Register a whole new file in `ALL_CAPABILITY_DETECTORS` (`../../capabilities/scan.ts`). The capability string must be in `CAPABILITY_ORDER` (`../../capabilities/types.ts`), and bumping a capability detector requires bumping `CAPABILITY_VERSION` (guarded by `tests/corpus-version-guard.test.ts`).

## Not detectors

The capability **pipeline** (collector, scan, backfill, corpus, eval, types) lives in `../capabilities/`, not here. This dir is detectors only.
