import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { assetRedirect } from '@/lib/releases'

// "Download Skillet for Mac" → 302 to the latest signed .dmg.
export async function GET(): Promise<Response> {
  await markDynamicRoute()
  return assetRedirect('mac')
}
