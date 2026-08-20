import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { assetRedirect } from '@/lib/releases'

// The Tauri auto-updater endpoint baked into the desktop app (see
// packages/desktop/src-tauri/tauri.conf.json). It 302s to the current release's
// latest.json, so every installed app updates through this one stable
// skillet.md URL and a repo/org rename never breaks the updater.
export async function GET(): Promise<Response> {
  await markDynamicRoute()
  return assetRedirect('updater')
}
