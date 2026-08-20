import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { assetRedirect } from '@/lib/releases'

// "Download Skillet for Windows" → 302 to the latest signed installer (.exe/.msi).
export async function GET(): Promise<Response> {
  await markDynamicRoute()
  return assetRedirect('windows')
}
