import { MARKDOWN_CONTENT_TYPE } from '@/lib/content-negotiation'
import { notFoundMarkdownBody } from '@/lib/agent-surface'
import { renderMarkdown } from '@/lib/markdown-representation'

/**
 * The Markdown half of content negotiation.
 *
 * `proxy.ts` rewrites here when a client prefers `text/markdown` over
 * `text/html` for a page that has a Markdown representation; the URL the client
 * sees never changes. The rewritten path carries the original pathname, so
 * `/docs/install` arrives as `/api/md/docs/install`.
 *
 * `Vary: Accept` is set here as well as on the rewrite, because a rewrite's
 * response headers come from THIS handler — without it a shared cache could
 * hand this Markdown to the next browser that asks for the same URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<Response> {
  const { slug = [] } = await params
  const pathname = slug.length ? `/${slug.join('/')}` : '/'

  const representation = await renderMarkdown(pathname)
  if (!representation) {
    return new Response(notFoundMarkdownBody(pathname), {
      status: 404,
      headers: {
        'content-type': MARKDOWN_CONTENT_TYPE,
        vary: 'Accept, Accept-Encoding',
        'cache-control': 'public, max-age=60',
        'x-robots-tag': 'noindex',
      },
    })
  }

  return new Response(representation.body, {
    status: 200,
    headers: {
      'content-type': MARKDOWN_CONTENT_TYPE,
      vary: 'Accept, Accept-Encoding',
      'cache-control': `public, max-age=${representation.maxAge}, stale-while-revalidate=86400`,
      // The canonical URL is the negotiated one, not this internal path.
      link: `<${pathname}>; rel="canonical", </llms.txt>; rel="describedby"`,
    },
  })
}

export const HEAD = GET
