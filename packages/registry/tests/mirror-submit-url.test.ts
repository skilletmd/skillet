// Submitting a mirror by URL from /admin, instead of editing a 76-entry JSON
// file, committing, deploying, and waiting for the nightly.
//
// The rule this pins: a pasted candidate must be indistinguishable from a
// discovered one. Same legality screen, same quality assessment, same queue
// row, same approve path. A second screening implementation would drift, which
// is exactly how sync and publish diverged on the scan boundary.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(join(process.cwd(), 'src/routes/mirror-queue.ts'), 'utf8')
const discovery = readFileSync(join(process.cwd(), 'src/mirror-ops/discovery.ts'), 'utf8')

const submitBlock = /app\.post<\{ Body: \{ url\?: string \} \}>[\s\S]*?\n    \);/.exec(route)

describe('submitting a repo by URL', () => {
  it('exposes an admin-only POST on the queue', () => {
    assert.ok(submitBlock, 'the submit route should exist')
    assert.match(submitBlock[0], /'\/api\/v1\/admin\/mirror-queue'/)
    assert.match(submitBlock[0], /preHandler: requireAdmin\(\)/)
  })

  it('reuses the same screen and quality pass discovery uses', () => {
    assert.match(submitBlock[0], /screenCandidate\(/)
    assert.match(submitBlock[0], /assessCandidateQuality\(/)
    assert.match(discovery, /screenCandidate\(/)
    assert.match(discovery, /assessCandidateQuality\(/)
  })

  it('writes the same screen_notes shape so the row ranks in the same list', () => {
    // The admin table parses this prefix to score and sort.
    const shape = /quality \$\{quality\.score\}\/100 across \$\{quality\.skillCount\} skills/
    assert.match(submitBlock[0], shape)
    assert.match(discovery, shape)
  })

  it('derives the handle from GitHub, never from the submitted URL', () => {
    // Handle squatting: the URL is attacker-controlled, the owner login is not.
    assert.match(submitBlock[0], /derived_handle: screen\.derivedHandle/)
  })
})

describe('submitting is not approving', () => {
  it('lands as pending_review when the screen passes', () => {
    assert.match(submitBlock[0], /screen\.pass \? 'pending_review' : 'rejected_screen'/)
  })

  it('applies no minimum score, unlike the discovery sweep', () => {
    // A human went and found this one; the score informs the decision rather
    // than making it. It still lands with notes, so a weak one reads as weak.
    assert.doesNotMatch(submitBlock[0], /minScore/)
  })
})

describe('answers, not faults', () => {
  it('reports an already-queued repo instead of colliding on the unique index', () => {
    assert.match(submitBlock[0], /already_queued/)
    assert.match(submitBlock[0], /normalized_repo_key: key/)
  })

  it('refuses to record a throttled screen as a verdict', () => {
    // Same rule discovery follows: unjudged is not rejected.
    assert.match(submitBlock[0], /screen\.transient/)
    assert.match(submitBlock[0], /screen_unavailable/)
  })

  it('rejects an unparseable URL before touching GitHub', () => {
    assert.match(submitBlock[0], /unparseable_url/)
  })
})
