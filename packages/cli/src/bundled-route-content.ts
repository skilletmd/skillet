// The route skill's SKILL.md, inlined at bundle time (esbuild `define` in
// scripts/bundle-cli.mjs) so it survives inside the pkg-compiled desktop
// sidecar — pkg never snapshots `dist/bundled-skills`, so the on-disk copy is
// unreachable there. In dev (tsx runs src directly, no define) the symbol is
// undefined and the caller reads the SKILL.md from disk, which exists in the
// source tree.
declare const __SKILLET_ROUTE_SKILL_MD__: string;

export function inlinedRouteSkillMd(): string | undefined {
  return typeof __SKILLET_ROUTE_SKILL_MD__ !== "undefined"
    ? __SKILLET_ROUTE_SKILL_MD__
    : undefined;
}
