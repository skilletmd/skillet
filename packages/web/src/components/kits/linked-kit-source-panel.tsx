'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { GitHubIcon } from '@/components/auth-provider-icons'
import { Panel } from '@/components/ui/panel'
import { formatShortDate } from '@/lib/feed-format'
import { registryAuthApi } from '@/lib/registry-proxy'
import {
  pullKitFromSource,
  type ImportProgress,
  type PullKitResult,
} from '@/lib/import-repo-as-kit'
import type { KitPayload } from '@/lib/kits'

/** Owner controls for a linked kit: pull the latest from the source repo
 * (resync IN), or unlink to convert it to a normal owned kit. */
export function LinkedKitSourcePanel({ kit }: { kit: KitPayload }) {
  const router = useRouter()
  const source = kit.source
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress[]>([])
  const [result, setResult] = useState<PullKitResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!source) return null

  const existingSlugs = new Set(
    kit.skills.map((s) => s.skill_id.slice(s.skill_id.indexOf(':') + 1)),
  )

  async function pull() {
    if (!source) return
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress([])
    try {
      const res = await pullKitFromSource({
        author: kit.owner,
        kitId: kit.id,
        source: { repo: source.repo, ref: source.ref, path: source.path },
        visibility: kit.visibility,
        existingSlugs,
        onProgress: (e) =>
          setProgress((prev) => {
            const next = [...prev]
            const i = next.findIndex((p) => p.index === e.index)
            if (i >= 0) next[i] = e
            else next.push(e)
            return next
          }),
      })
      setResult(res)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pull from the source.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    if (
      !window.confirm(
        'Disconnect this kit from its repo? It becomes a normal kit you edit in Skillet.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await fetch(registryAuthApi(`kits/${kit.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ unlink: true }),
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink.')
    } finally {
      setBusy(false)
    }
  }

  const done = progress.filter((p) => p.status !== 'publishing').length

  return (
    <Panel padding="none" className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <GitHubIcon className="h-7 w-7 shrink-0 text-(--ink)" />
          <div className="min-w-0">
            <a
              href={`https://github.com/${source.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-sm font-semibold text-(--ink) hover:text-(--accent)"
            >
              {source.repo}
              {source.path ? `/${source.path}` : ''}
            </a>
            <p className="text-xs text-(--ink-2)">
              {kit.last_updated ? `Synced ${formatShortDate(kit.last_updated)}` : 'Not synced yet'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="tertiary" disabled={busy} onClick={() => void unlink()}>
            Disconnect
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void pull()}>
            {busy ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-sm text-(--ink-2)">
        Make changes in the repo, then sync here. Or disconnect to edit in Skillet.
      </p>

      {busy && progress.length > 0 && (
        <p className="mt-3 text-xs text-(--ink-2)">
          Re-importing… {done} of {progress.length || existingSlugs.size}
        </p>
      )}

      {result && (
        <p className="mt-3 text-sm text-(--ink)">
          {result.updated.length} updated · {result.added.length} added · {result.unchanged}{' '}
          unchanged
          {result.failed.length > 0 && (
            <span className="text-(--danger)"> · {result.failed.length} failed</span>
          )}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-(--danger)">{error}</p>}
    </Panel>
  )
}
