'use client'

import type { ReactNode } from 'react'
import { signOut } from 'next-auth/react'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AppLink } from '@/components/app-link'
import { loginHref } from '@/lib/urls'
import { GitHubMark, type ClaimOwnerType } from '@/components/mirror-notice'

/** GitHub read:org grant entry point (a route handler, so a hard navigation). */
function grantHref(handle: string): string {
  return `/api/github/claim-org/start?handle=${encodeURIComponent(handle)}`
}

function CloseX() {
  return (
    <DialogClose
      type="button"
      aria-label="Close"
      className="absolute right-3.5 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-(--ink-2) transition-colors hover:bg-(--accent-bg) hover:text-(--ink)"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </DialogClose>
  )
}

/** One claim path: a bold label, a one-line description, and an optional action. */
function Path({
  label,
  children,
  action,
}: {
  label: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border border-(--line) p-3.5">
      <p className="text-sm font-semibold text-(--ink)">{label}</p>
      <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">{children}</p>
      {action && <div className="mt-auto pt-3">{action}</div>}
    </div>
  )
}

/**
 * Unclaimed brand mirror: a small "Own this on GitHub? Claim" trigger that opens a
 * modal laying out the two ways to claim. The end-state is decided by the session,
 * so the matching path carries the GitHub action and the other path explains how to
 * switch (log in / log out). A personal (single-account) claim only applies to a
 * User-owned GitHub source; an Organization source can only be claimed as a team.
 */
export function ClaimMirrorModal({
  handle,
  sourceUrl,
  authed,
  sourceOwnerType,
}: {
  handle: string
  /** The GitHub source URL, shown (icon + link) so the claimant knows what to own. */
  sourceUrl: string | null
  authed: boolean
  sourceOwnerType: ClaimOwnerType | null
}) {
  const isUserSource = sourceOwnerType === 'User'
  const sourceRepo = sourceUrl
    ? sourceUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '') || null
    : null

  const githubAction = (
    <Button href={grantHref(handle)} size="sm">
      Continue with GitHub
    </Button>
  )
  const loginAction = (
    <Button href={loginHref(`/${handle}`)} variant="secondary" size="sm">
      Log in
    </Button>
  )
  // The logged-in single-account path: log out and land back here, where the
  // single-account claim becomes the available path.
  const logoutAction = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button variant="secondary" size="sm" onClick={() => void signOut({ redirectTo: `/${handle}` })}>
        Log out
      </Button>
      <span className="text-sm text-(--ink-2)">to claim this way</span>
    </span>
  )

  const teamPath = (active: boolean) => (
    <Path label="Claim as a team" action={active ? githubAction : authed ? undefined : loginAction}>
      Manage under your existing account and invite others to co-manage.
    </Path>
  )

  const accountPath = (active: boolean) => (
    <Path label="Claim as a single account" action={active ? githubAction : logoutAction}>
      @{handle} becomes one personal account that is just you.
    </Path>
  )

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="self-start text-left text-sm text-(--ink-2) transition-colors hover:text-(--ink)"
        >
          Own this repo?{' '}
          <span className="font-medium text-(--ink) underline underline-offset-2">Claim it</span>
        </button>
      </DialogTrigger>

      <DialogContent className="w-[min(92vw,600px)]">
        <CloseX />
        <DialogTitle className="text-lg font-semibold text-(--ink)">Claim @{handle}</DialogTitle>
        <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
          Verify you are an owner or admin of{' '}
          {sourceRepo && sourceUrl ? (
            <span className="whitespace-nowrap">
              <GitHubMark className="mr-1 inline-block h-[1em] w-[1em] align-[-0.15em] text-(--ink)" />
              <AppLink
                href={sourceUrl}
                className="font-medium text-(--ink) underline underline-offset-2"
              >
                {sourceRepo}
              </AppLink>
            </span>
          ) : (
            'the GitHub source'
          )}{' '}
          to claim this account.
        </p>

        {/* Fixed order regardless of session: Team, then Single account. Only the
            action differs by session (the matching path gets Continue with GitHub;
            the other gets Log in / Log out to switch). */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {teamPath(authed)}
          {isUserSource && accountPath(!authed)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
