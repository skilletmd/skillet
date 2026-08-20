'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { AppLink } from '@/components/app-link'
import { pluralize } from '@/lib/format'
import type { OwnedRepo } from '@/lib/github-repos'
import type { ConnectedRepo } from '@/lib/connected-repos'
import { useBfcacheRestore } from '@/lib/use-bfcache-restore'

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/**
 * Shared GitHub-import surface used identically on the Create hub and the import
 * wizard: paste any public repo, OR pick one of your own (when GitHub is linked),
 * plus a line for repos already syncing. The two surfaces only differ in what
 * happens on submit — pass `onUse` to handle it inline (the wizard discovers in
 * place); omit it and the panel navigates to /import?url= (the hub launcher).
 */
export function GithubImportPanel({
  githubLinked = false,
  available = [],
  connected = [],
  onUse,
  busy = false,
  error = null,
  connectReturn = '/import',
}: {
  githubLinked?: boolean
  /** Repos you own that aren't syncing yet. */
  available?: OwnedRepo[]
  /** Repos already syncing (drives the "Syncing N · manage" line). */
  connected?: ConnectedRepo[]
  /** Handle a chosen repo inline; when omitted, the panel navigates to /import. */
  onUse?: (target: string) => void
  busy?: boolean
  error?: string | null
  /** Where GitHub returns after connecting (the page hosting this panel). */
  connectReturn?: string
}) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [navigating, setNavigating] = useState(false)
  const isBusy = busy || navigating

  // Coming back via the browser's back button must not leave the submit
  // button stuck on the "Working…" state from the outbound navigation.
  useBfcacheRestore(() => setNavigating(false))

  function use(target: string) {
    const t = target.trim()
    if (!t) return
    if (onUse) {
      onUse(t)
      return
    }
    setNavigating(true)
    router.push(`/import?url=${encodeURIComponent(t)}`)
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          use(url)
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <GithubMark className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-(--ink-2)" />
          <Input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="owner/repo or a GitHub URL"
            aria-label="GitHub repo"
            className="pl-10 text-sm"
          />
        </div>
        <Button type="submit" variant="primary" disabled={isBusy || !url.trim()} className="h-10">
          {isBusy ? 'Working…' : 'Find skills'}
        </Button>
      </form>

      <div className="border-t border-(--line) pt-4">
        {githubLinked ? (
          available.length > 0 ? (
            <div>
              <label className="text-xs font-medium text-(--ink-2)">Or pick a repo you own</label>
              <Select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) use(`https://github.com/${e.target.value}`)
                }}
                className="mt-1 font-mono text-sm"
              >
                <option value="">Select a repo…</option>
                {available.map((r) => (
                  <option key={r.full} value={r.full}>
                    {r.full}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <p className="text-xs text-(--ink-2)">
              GitHub connected. Paste one of your own repos above to import it or keep it synced.
            </p>
          )
        ) : (
          <p className="text-xs text-(--ink-2)">
            <AppLink
              href={`/api/github/connect/start?return=${encodeURIComponent(connectReturn)}`}
              className="font-medium text-(--ink) underline underline-offset-2 hover:text-(--accent)"
            >
              Connect GitHub
            </AppLink>{' '}
            to import your own repos (including private) and keep them auto-synced.
          </p>
        )}

        {connected.length > 0 && (
          <p className="mt-2 text-xs text-(--ink-2)">
            Syncing {connected.length} {pluralize(connected.length, 'repo')} ·{' '}
            <Link href="/settings/github" className="underline underline-offset-2">
              manage
            </Link>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-(--danger)">{error}</p>}
    </div>
  )
}
