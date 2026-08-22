import { getPublishedSkill } from '@/lib/agent-skills-index'
import { MARKDOWN_CONTENT_TYPE } from '@/lib/content-negotiation'

/**
 * `/.well-known/agent-skills/{name}/SKILL.md` — the artifact an index entry
 * points at. Served as the exact bytes the index digested, so a client's
 * SHA-256 check passes; anything that reformatted the file here would make
 * every published digest wrong.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params
  const skill = getPublishedSkill(name)
  if (!skill) {
    return new Response(`# 404 Not Found\n\nNo skill named \`${name}\` is published here.\nSee /.well-known/agent-skills/index.json for the list.\n`, {
      status: 404,
      headers: { 'content-type': MARKDOWN_CONTENT_TYPE },
    })
  }
  return new Response(skill.content, {
    headers: {
      'content-type': MARKDOWN_CONTENT_TYPE,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      etag: `"${skill.digest}"`,
    },
  })
}

export const HEAD = GET
