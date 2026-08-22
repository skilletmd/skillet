import { agentSkillsIndex } from '@/lib/agent-skills-index'

/**
 * `/.well-known/agent-skills/index.json` — Agent Skills discovery index
 * (draft v0.2.0, RFC 8615 well-known URI).
 *
 * The spec requires `application/json`, GET and HEAD, and a 404 for skills that
 * do not exist. CORS is open because a browser-based agent should be able to
 * enumerate what this origin publishes.
 */
export function GET(): Response {
  return new Response(JSON.stringify(agentSkillsIndex(), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  })
}

export const HEAD = GET
