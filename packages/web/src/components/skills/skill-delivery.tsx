import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { readSessionCookie } from '@/lib/session-cookie'
import { fetchMcpLink } from '@/lib/mcp-link'
import { getAuthorProfile } from '@/lib/registry'
import { SkillDeliveryBar } from '@/components/skills/skill-action-row'

/**
 * Viewer state for the skill page's action row, resolved inside a Suspense hole.
 *
 * The skill route deliberately reads no session for a public skill so the page
 * stays statically CDN-cacheable, and the bar needs three things that only a
 * session can answer: which runtimes the account syncs to, whether an MCP link
 * is already on, and whether the viewer is signed in at all. Fetching them up in
 * the route would make every public skill page dynamic. Doing it here, behind
 * the boundary the Add control already sits in, keeps the shell static and lets
 * this stream in.
 *
 * Never throws: a connector or profile lookup failing degrades the bar to its
 * install state rather than taking the page down.
 */
export async function SkillDelivery({
  author,
  slug,
}: {
  author: string
  slug: string
}) {
  const session = await auth().catch(() => null)
  const handle = session?.handle ?? null

  const [profile, mcpLink] = await Promise.all([
    handle ? getAuthorProfile(handle).catch(() => null) : Promise.resolve(null),
    handle
      ? (async () => {
          const token = readSessionCookie(await cookies())
          return token ? fetchMcpLink(token).catch(() => null) : null
        })()
      : Promise.resolve(null),
  ])

  const runtimes = (profile?.runtimes?.map((r) => r.key) ?? profile?.detectedRuntimes ?? []).filter(
    Boolean,
  )
  const mcpUrl = mcpLink?.ok && mcpLink.enabled ? mcpLink.link.url : null

  return (
    <SkillDeliveryBar
      author={author}
      slug={slug}
      runtimes={runtimes}
      mcpUrl={mcpUrl}
      signedIn={!!handle}
    />
  )
}
