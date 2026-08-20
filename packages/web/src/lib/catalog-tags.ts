// Cache tags for every public catalog surface (see registry-catalog.ts). A content
// write busts all of them — writes are far rarer than reads, so over-busting a few
// cheap catalog queries is the right trade for keeping discovery effectively live.
//
// Two write paths must flush these: the browser BFF proxy
// (app/api/registry/[...path]/route.ts) for browser-originated writes, and the
// admin server actions (app/admin/featured/page.tsx) that call the registry
// server-to-server and so never pass through the proxy.
export const CATALOG_TAGS = [
  'catalog:skills',
  'catalog:kits',
  'catalog:people',
  'discover-feed',
  'skill-kits',
] as const
