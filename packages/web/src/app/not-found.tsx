import { NotFoundBody } from '@/components/not-found-body'

// Branded 404 — rendered for any notFound() (unknown skill slug, unknown
// author) and for unmatched routes. Keeps the public surface on-brand instead
// of falling back to Next's bare default page. The body itself lives in a
// shared component so routes that must render it directly (see the blog post
// route) show identical content.
export default function NotFound() {
  return <NotFoundBody />
}
