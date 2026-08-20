import { getBlogDb } from './blog-db'

/** Lightweight blog DB probe for load balancers and PM2 deploy scripts. */
export function checkBlogDbHealth(): { ok: true } {
  const db = getBlogDb()
  db.prepare('SELECT 1 AS n').get()
  return { ok: true }
}
