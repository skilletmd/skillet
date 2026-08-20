'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { MarkdownContent } from '@/components/markdown-content'
import { FrontmatterCard } from '@/components/skills/frontmatter-card'
import { SkillDownloadMenu } from '@/components/skills/skill-download-menu'
import { Tooltip } from '@/components/ui/tooltip'
import { SKILL_ENTRYPOINT } from '@/lib/skill-bundle'
import { bundleImageResolver, type SkillBundleAssets } from '@/lib/bundle-images'

/** `</>` — toggles between rendered Markdown and raw source. */
function CodeIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 6.5 4 10l3.5 3.5M12.5 6.5 16 10l-3.5 3.5M11.2 5.8 8.8 14.2" />
    </svg>
  )
}

/**
 * Single-file skill viewer: SKILL.md on its own. Same window chrome, Markdown
 * toggle, and capped-scroll body as the multi-file {@link SkillFileTree}, so both
 * viewers read as one system — a fixed height with the document scrolling inside,
 * never a fade/"Show full" collapse. `compact` is the half-height inline preview;
 * the overlay runs full height.
 */
export function SkillDocumentView({
  source,
  frontmatter,
  author,
  slug,
  assets,
  headerAction,
  compact,
}: {
  source: string
  /** Raw YAML frontmatter — rendered as a header card in rendered mode. */
  frontmatter?: string | null
  author: string
  slug: string
  /** Raw-image URL context — enables markdown image resolution in SKILL.md. */
  assets?: SkillBundleAssets
  /** Optional trailing control in the header bar (e.g. the Expand-to-overlay icon). */
  headerAction?: ReactNode
  /** Half-height inline preview; the overlay runs full height. */
  compact?: boolean
}) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  return (
    <Panel padding="none" className="skill-document overflow-hidden">
      <div className="flex items-center gap-2 border-b border-(--line) px-4 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink-2)">
          {SKILL_ENTRYPOINT}
        </span>
        <Tooltip content={mode === 'source' ? 'Show rendered' : 'Show source'}>
          <Button
            variant="icon"
            type="button"
            onClick={() => setMode((m) => (m === 'rendered' ? 'source' : 'rendered'))}
            className="shrink-0 aria-pressed:bg-(--accent-bg)"
            aria-pressed={mode === 'source'}
            aria-label={mode === 'source' ? 'Show rendered' : 'Show source'}
          >
            <CodeIcon />
          </Button>
        </Tooltip>
        <SkillDownloadMenu author={author} slug={slug} />
        {headerAction}
      </div>
      <div
        className={`overflow-y-auto ${compact ? 'h-[clamp(240px,34vh,380px)]' : 'h-[clamp(440px,64vh,720px)]'}`}
      >
        {mode === 'rendered' ? (
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            {frontmatter && <FrontmatterCard yaml={frontmatter} />}
            <MarkdownContent
              content={source}
              variant="compact"
              resolveImageSrc={assets ? bundleImageResolver(assets, SKILL_ENTRYPOINT) : undefined}
            />
          </div>
        ) : (
          <div className="p-4">
            <pre className="overflow-x-auto rounded-lg bg-(--bg) py-3 font-mono text-xs leading-[1.6] text-(--ink)">
              {source.split('\n').map((ln, i) => (
                <div key={i} data-skill-line={i + 1} className="px-3">
                  {ln || ' '}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </Panel>
  )
}
