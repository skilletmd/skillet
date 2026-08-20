'use client'

import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button, buttonClasses } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { REGISTRY_API } from '@/lib/registry-prefix'

/**
 * Quiet "use this elsewhere" affordance — a download icon beside the SKILL.md
 * Markdown toggle. The hero action is Add/sync; this is the fallback for
 * upload-only surfaces (ChatGPT, a Claude Project, a manual install), so the
 * popover leads by pointing back at sync and treats download as the static copy.
 *
 * Always a .zip — a skill is a folder (`<slug>/SKILL.md` + any files), so the
 * archive preserves that structure for a drop-in manual install.
 */
function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M8 2.5v6.5m0 0 2.5-2.5M8 9 5.5 6.5M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SkillDownloadMenu({ author, slug }: { author: string; slug: string }) {
  const zipHref = `/api/registry${REGISTRY_API}/skills/${encodeURIComponent(
    author,
  )}/${encodeURIComponent(slug)}/download`

  return (
    <Popover>
      <Tooltip content="Download">
        <PopoverTrigger asChild>
          <Button
            variant="icon"
            type="button"
            className="shrink-0"
            aria-label="Download"
          >
            <DownloadIcon />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-sm font-semibold text-(--ink)">Use this elsewhere</p>
        <p className="mt-1.5 text-xs leading-relaxed text-(--ink-2)">
          Best: <span className="font-medium text-(--ink)">Add it</span>. It syncs into your AI
          tools and stays up to date.
        </p>
        <div className="my-3 h-px bg-(--line)" />
        <a href={zipHref} download className={buttonClasses('secondary', { block: true })}>
          <DownloadIcon />
          Download skill (.zip)
        </a>
        <p className="mt-2.5 text-xs leading-relaxed text-(--ink-2)">
          A static copy. It won&rsquo;t update. Good for ChatGPT, a Claude Project, or a manual
          install.
        </p>
      </PopoverContent>
    </Popover>
  )
}
