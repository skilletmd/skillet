// robots.txt, owned here rather than by Cloudflare.
//
// This was a typed `robots.ts` until Cloudflare's "Manage your robots.txt"
// setting started prepending a managed block at the edge that disallowed
// ClaudeBot, GPTBot, Google-Extended, CCBot and five others: a policy change to
// our crawl surface that never passed through review. That setting is now off,
// and the policy lives here where it diffs like everything else.
//
// A route handler rather than `MetadataRoute.Robots` because Next's typed
// robots API can only emit userAgent/allow/disallow/crawlDelay, and the
// Content-Signal directive below is none of those.

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

// Verbatim from the Content Signals Policy (contentsignals.org), which is meant
// to be copied. Reproduced in full because the reservation of rights in the last
// paragraph is what gives the signals their legal weight.
const CONTENT_SIGNALS_PREAMBLE = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a Content-Signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a Content-Signal = no, you may not collect content for the
#      corresponding use.
# (c)  If the website operator does not include a Content-Signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via Content-Signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.`

// Signal, not enforcement. ai-input=yes is the affirmative grant that matters
// most to us: an agent answering "who has a good code-review skill" should be
// able to ground that answer in this catalog. ai-train=no reserves the training
// right without refusing the fetch, so the crawlers that carry us into an answer
// (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User, Claude-SearchBot,
// ClaudeBot, Google-Extended, Googlebot) all stay allowed.
const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no'

// Authed-only and write surfaces: nothing for an index to hold, and a crawler
// that follows them just burns budget on a login redirect.
const DISALLOWED_PATHS = [
  '/feed/',
  '/notifications',
  '/updates',
  '/settings/',
  '/connect',
  '/import',
  '/create',
  '/login',
]

const body = [
  CONTENT_SIGNALS_PREAMBLE,
  '',
  'User-agent: *',
  `Content-Signal: ${CONTENT_SIGNAL}`,
  'Allow: /',
  ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
  '',
  `Sitemap: ${new URL('/sitemap.xml', BASE).toString()}`,
  '',
].join('\n')

export function GET() {
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
