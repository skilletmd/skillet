# Reference stability policy

Skillet treats published skill references as **permanent contracts**. Once a version hash or `@author/slug` is synced into a kit, dependent machines must keep resolving it.

## Identifiers

| Identifier | Stability rule |
|------------|----------------|
| `schema_version` | **Artifact wire format** (manifest, lockfile, local state). Currently `1`. Bump only on breaking shape changes. |
| `sha256:<hex>` (content hash) | **Immutable forever.** Bytes never deleted; yank hides from catalog only. |
| `@author/slug` | **Stable pointer.** Renames add aliases; old refs redirect. Never hard-deleted. |
| Handle (`author`) | **Renamable with redirect.** `handle_aliases` maps old → new permanently. |

## Lifecycle actions

### Deprecate (skill)

Owner soft-sunsets a skill: hidden from public catalog, still fetchable for existing kit members and pinned hashes. Use `POST /v1/skills/:author/:slug/deprecate`.

### Yank (version)

Owner removes a **specific version** from new installs: hidden from `latest_hash`, flagged in manifest, blocked on `skillet add`. **Existing pins and hash fetches still work.** Use `POST /v1/skills/:author/:slug/versions/:hash/yank`.

### Ban (author)

Account suspension blocks **new publishes** only. Published hashes remain fetchable for kits that already depend on them.

### Delete

There is **no hard delete** in v1. Unpublish = deprecate + yank.

## Client behavior

- `skillet add` refuses yanked latest versions.
- `skillet sync` skips upgrading into a yanked latest; pinned hashes still verify.
- Sync manifest may include `deprecated: true` on items; clients surface but do not drop pinned bytes.

## Registry implementation

- `handle_aliases`, `skill_aliases` — redirect tables (see `packages/registry/src/lib/ref-resolution.ts`)
- `skill_versions.yanked_at` — version yank marker
- `users.suspended_at` — publish gate

## npm lessons we avoid

- **left-pad:** never unpublish bytes someone depends on
- **squatting:** `reserved-handles.ts` at claim time
- **rename breakage:** alias redirects, not in-place ID rewrites
