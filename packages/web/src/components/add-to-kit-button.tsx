'use client'

import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Plus } from '@/components/ui/icons'
import { CommandBlock } from '@/components/command-block'
import { SkillKitControl } from '@/components/kits/skill-kit-control'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { parseKitSkillRef } from '@/lib/kits'
import { addIntentClaimHref, addIntentLoginHref, skillHref } from '@/lib/urls'

/**
 * Primary install action — the hero Add control (or a sign-in CTA). Lives in the
 * page header, top-right beside the title, like the Add control on cards. The
 * CLI path is split into {@link CliInstall} so this stays narrow and never
 * squeezes the title.
 */
export function AddToKitButton({ refName }: { refName: string }) {
  const kitsCtx = useMyKitsOptional()
  const { data: session } = useSession()
  const parsed = parseKitSkillRef(refName)
  if (!parsed) {
    return <p className="text-sm text-(--ink-2)">Invalid skill ref.</p>
  }
  const callbackUrl = skillHref(parsed.author, parsed.slug)

  if (!kitsCtx) {
    // No membership context means the viewer can't add yet — either signed out,
    // or signed in without a claimed username (the provider only mounts once a
    // handle exists). One acquisition verb across Skillet: both get the same
    // primary "Add", not a friction-first "Sign in". A signed-out click carries
    // the intent through login (and the magic-link email); a signed-in-but-
    // handle-less click goes to claim a username first — either way the intent
    // replays and the skill auto-adds on return (see AddIntentHandler).
    const intent = { type: 'skill' as const, author: parsed.author, slug: parsed.slug }
    const href = session
      ? addIntentClaimHref(intent)
      : addIntentLoginHref(intent, callbackUrl)
    return (
      <Button href={href} variant="primary" size="lg">
        <Plus className="h-4 w-4" />
        <span>
          Add<span className="hidden sm:inline">&nbsp;skill</span>
        </span>
      </Button>
    )
  }

  return <SkillKitControl author={parsed.author} slug={parsed.slug} variant="hero" />
}

/** Secondary install path — a quiet "CLI install" disclosure for the page body. */
export function CliInstall({ refName }: { refName: string }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-(--ink-2) transition-colors hover:text-(--ink) [&::-webkit-details-marker]:hidden">
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="-rotate-90 transition-transform duration-200 group-open:rotate-0"
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        CLI install
      </summary>
      <div className="mt-3 max-w-md">
        <CommandBlock command={`skillet add ${refName}`} accent={refName} size="sm" wrap />
      </div>
    </details>
  )
}
