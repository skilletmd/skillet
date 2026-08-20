import { checkBlogDbHealth } from '@/lib/blog-health'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export async function GET() {
  await markDynamicRoute()
  try {
    checkBlogDbHealth()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false, error: 'db_unavailable' }, { status: 503 })
  }
}
