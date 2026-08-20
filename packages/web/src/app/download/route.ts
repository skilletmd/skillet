import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { assetRedirect } from '@/lib/releases'

// Bare /download → OS-detect from the User-Agent and 302 to the right installer.
// Windows UAs get the Windows build; everything else defaults to the macOS .dmg.
export async function GET(req: Request): Promise<Response> {
  await markDynamicRoute()
  const ua = req.headers.get('user-agent') ?? ''
  return assetRedirect(/windows/i.test(ua) ? 'windows' : 'mac')
}
