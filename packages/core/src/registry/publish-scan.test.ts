import { describe, it, expect } from 'vitest'
import { RegistryClient, RegistryError, type ScanBlockedBody } from './client.js'

function clientWith(response: { status: number; body: unknown }) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
  return new RegistryClient({ baseUrl: 'https://r.test', token: 't', fetchImpl })
}

const publishBody = {
  author: 'alice',
  slug: 'tool',
  files: { 'SKILL.md': { enc: 'utf8' as const, data: '---\nname: x\n---\n' } },
  base_hash: null,
}

describe('RegistryClient.publishSkill — scan gate', () => {
  it('maps a 422 scan_blocked (quarantine) to a typed RegistryError carrying findings', async () => {
    const client = clientWith({
      status: 422,
      body: {
        error: 'scan_blocked',
        reason: 'quarantine',
        status: 'quarantined',
        message: 'Publish blocked by our scanner. Fix the flagged patterns and republish.',
        findings: [{ category: 'destructive', confidence: 'high', file: 'SKILL.md', lineStart: 9, lineEnd: 9, why: 'rm -rf /' }],
      } satisfies ScanBlockedBody,
    })
    await expect(client.publishSkill(publishBody)).rejects.toMatchObject({
      code: 'scan_blocked',
      status: 422,
    })
    try {
      await client.publishSkill(publishBody)
    } catch (err) {
      const body = (err as RegistryError).body as ScanBlockedBody
      expect(body.reason).toBe('quarantine')
      expect(body.findings[0].category).toBe('destructive')
    }
  })

  it('maps a 422 scan_blocked (secret) too', async () => {
    const client = clientWith({
      status: 422,
      body: {
        error: 'scan_blocked',
        reason: 'secret',
        status: 'quarantined',
        message: 'Publish blocked: a credential was detected.',
        findings: [{ category: 'secret', confidence: 'high', file: 'setup.sh', lineStart: 1, lineEnd: 1, why: 'aws key' }],
      } satisfies ScanBlockedBody,
    })
    const err = await client.publishSkill(publishBody).catch((e) => e)
    expect(err).toBeInstanceOf(RegistryError)
    expect((err as RegistryError).code).toBe('scan_blocked')
    expect(((err as RegistryError).body as ScanBlockedBody).reason).toBe('secret')
  })

  it('returns the flagged verdict on a successful 201 publish', async () => {
    const client = clientWith({
      status: 201,
      body: {
        hash: 'sha256:abc',
        skill_id: 'alice:tool',
        version_url: '/api/v1/skills/alice/tool/versions/sha256:abc',
        scan: { status: 'flagged', findings: [{ category: 'obfuscation', confidence: 'medium', file: 'SKILL.md', lineStart: 6, lineEnd: 6, why: 'base64' }] },
      },
    })
    const res = await client.publishSkill(publishBody)
    expect(res.already_exists).toBe(false)
    expect(res.scan?.status).toBe('flagged')
    expect(res.scan?.findings).toHaveLength(1)
  })

  it('treats a non-scan 422 as a generic publish failure (not scan_blocked)', async () => {
    const client = clientWith({ status: 422, body: { error: 'bundle_invalid', message: 'bad bundle' } })
    const err = await client.publishSkill(publishBody).catch((e) => e)
    expect(err).toBeInstanceOf(RegistryError)
    expect((err as RegistryError).code).not.toBe('scan_blocked')
  })
})
