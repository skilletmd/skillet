'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
// Browser-native canonical hash — byte-identical to @skillet/protocol's, but
// node-free. The barrel's canonicalContentHash calls Buffer.writeBigUInt64BE,
// which Next's client Buffer shim does not implement, so hashing there throws
// ("writeBigUInt64BE is not a function") when the proposer submits.
import { canonicalContentHash } from '@/lib/webcrypto-content-hash'
import { FileDiff } from '@/components/file-diff'
import { SkillFilesEditor } from '@/components/skill-files-editor'
import { bindBrowserSigningOnce } from '@/lib/browser-signing-bind'
import {
  checkProposeAccess,
  createSkillProposal,
  fetchSkillVersionBundle,
  ProposalSubmitError,
} from '@/lib/create-proposal'
import { delegationErrorUX, isDelegationErrorCode } from '@/lib/delegation-errors'
import { signContentHashForProposal } from '@/lib/proposal-signing'
import {
  computeBundleDiff,
  decodeFile,
  entryFromText,
  hasBundleChanges,
  validateBundleFiles,
  SKILL_ENTRYPOINT,
  type BundleFiles,
} from '@/lib/skill-bundle'
import { fetchSkillManifest } from '@/lib/skill-studio-client'
import { Button } from '@/components/ui/button'
import { skillHref } from '@/lib/urls'

export function SkillProposeForm({
  author,
  slug,
  sessionHandle = null,
}: {
  author: string
  slug: string
  sessionHandle?: string | null
}) {
  const router = useRouter()
  const [baseFiles, setBaseFiles] = useState<BundleFiles>({})
  const [proposedFiles, setProposedFiles] = useState<BundleFiles>({})
  const [baseHash, setBaseHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [signingReady, setSigningReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleBase, setStaleBase] = useState(false)

  const diff = useMemo(
    () => computeBundleDiff(baseFiles, proposedFiles),
    [baseFiles, proposedFiles],
  )
  const hasChanges = useMemo(
    () => hasBundleChanges(baseFiles, proposedFiles),
    [baseFiles, proposedFiles],
  )
  const validation = useMemo(() => validateBundleFiles(proposedFiles), [proposedFiles])

  const ensureSigningReady = useCallback(async () => {
    try {
      await bindBrowserSigningOnce(sessionHandle)
      setSigningReady(true)
      return true
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not set up browser signing. Try signing out and back in.',
      )
      return false
    }
  }, [sessionHandle])

  const loadBase = useCallback(async () => {
    setError(null)
    setStaleBase(false)
    setLoading(true)

    const access = await checkProposeAccess(author, slug)
    if (access.kind === 'denied') {
      setAccessDenied(true)
      setLoading(false)
      return
    }

    try {
      const manifest = await fetchSkillManifest(author, slug)
      const hash = manifest?.latest_hash ?? null
      setBaseHash(hash)

      if (hash) {
        const bundleResult = await fetchSkillVersionBundle(author, slug, hash)
        if (bundleResult.kind === 'ok') {
          setBaseFiles(bundleResult.version.files)
          setProposedFiles(bundleResult.version.files)
        } else {
          throw new Error('Could not load the current skill version.')
        }
      } else {
        const empty = { [SKILL_ENTRYPOINT]: entryFromText('') }
        setBaseFiles({})
        setProposedFiles(empty)
      }

      await ensureSigningReady()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load skill.')
    } finally {
      setLoading(false)
    }
  }, [author, slug, ensureSigningReady])

  useEffect(() => {
    void loadBase()
  }, [loadBase])

  function mapSubmitError(err: unknown): string {
    if (!(err instanceof ProposalSubmitError)) {
      return err instanceof Error ? err.message : 'Proposal failed.'
    }
    if (isDelegationErrorCode(err.code)) {
      return delegationErrorUX(err.code).message
    }
    if (err.finding) {
      return `${err.message} (${err.finding.file}:${err.finding.lineStart})`
    }
    return err.message
  }

  async function onSubmit() {
    setBusy(true)
    setError(null)
    setStaleBase(false)
    try {
      const ready = await ensureSigningReady()
      if (!ready) return

      if (!hasChanges) {
        setError('No changes to submit. Edit a file first.')
        return
      }

      const blocking = [...validation.errors, ...validation.incomplete]
      if (blocking.length > 0) {
        setError(blocking[0])
        return
      }

      const manifest = await fetchSkillManifest(author, slug)
      const latestHash = manifest?.latest_hash ?? null
      if (latestHash && baseHash && latestHash !== baseHash) {
        setStaleBase(true)
        setError(
          'A newer version was published while you were editing. Refresh to rebase onto the latest version, then submit again.',
        )
        return
      }

      // Decode every entry to raw bytes (utf8 → TextEncoder, base64 → atob),
      // matching the protocol's decode, then hash over the same path→bytes map.
      const decoded = new Map<string, Uint8Array>()
      for (const [path, entry] of Object.entries(proposedFiles)) {
        decoded.set(path, decodeFile(entry).bytes)
      }
      const proposedHash = await canonicalContentHash(decoded)
      const signature = await signContentHashForProposal(proposedHash)

      const result = await createSkillProposal(author, slug, {
        files: proposedFiles,
        baseHash,
        signature,
      })

      router.push(
        `${skillHref(author, slug)}?proposal=${encodeURIComponent(result.proposal_id)}#proposed-changes`,
      )
    } catch (err: unknown) {
      if (err instanceof ProposalSubmitError && err.isStaleBase) {
        setStaleBase(true)
      }
      setError(mapSubmitError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-(--ink-2)">Loading current version…</p>
  }

  if (accessDenied) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
          Only the skill owner or a same-kit teammate can propose changes here. Third-party
          contributions are not supported yet.
        </p>
        <Link href={skillHref(author, slug)} className="text-sm text-(--accent)">
          Back to skill
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-(--ink-2)">
        Submit a signed proposal for{' '}
        <strong className="font-mono">
          @{author}/{slug}
        </strong>
        . An owner or team admin merges it on the review surface.
      </p>

      <SkillFilesEditor files={proposedFiles} onChange={setProposedFiles} />

      <section aria-labelledby="proposal-diff-heading">
        <h2
          id="proposal-diff-heading"
          className="font-mono text-sm tracking-[0.06em] text-(--accent)"
        >
          Preview changes
        </h2>
        <div className="mt-4">
          {hasChanges ? (
            <FileDiff files={diff} />
          ) : (
            <p className="font-mono text-sm text-(--ink-2)">
              No file changes yet. Edit SKILL.md above.
            </p>
          )}
        </div>
      </section>

      {error && (
        <div className="space-y-3">
          <p className="rounded-lg border border-(--danger-line) bg-(--danger-bg) px-4 py-3 text-sm text-(--danger)">
            {error}
          </p>
          {staleBase && (
            <Button type="button" onClick={() => void loadBase()} variant="secondary">
              Refresh from latest version
            </Button>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          disabled={
            busy ||
            !signingReady ||
            !hasChanges ||
            validation.errors.length > 0 ||
            validation.incomplete.length > 0
          }
          onClick={() => void onSubmit()}
          variant="primary"
        >
          {busy ? 'Submitting…' : 'Submit proposal'}
        </Button>
        <Button href={skillHref(author, slug)} variant="tertiary">
          Cancel
        </Button>
      </div>
    </div>
  )
}
