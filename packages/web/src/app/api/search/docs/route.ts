import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { searchDocs } from '@/lib/docs-search'

/**
 * Web-local documentation search. `searchUniversal` calls this in parallel with
 * the registry search and merges the `docs` group. On any failure it returns an
 * empty list with 200 so docs never break the rest of universal search.
 */
export async function GET(req: Request) {
  await markDynamicRoute()
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()
    const limitParam = Number(searchParams.get('limit'))
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(20, Math.floor(limitParam)) : 5
    return Response.json({ docs: q ? searchDocs(q, limit) : [] })
  } catch {
    return Response.json({ docs: [] })
  }
}
