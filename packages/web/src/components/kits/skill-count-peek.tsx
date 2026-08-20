'use client'

import { Tooltip } from '@/components/ui/tooltip'

/**
 * The "N skills" count on a kit cover, with a hover tooltip listing what's
 * inside — a targeted peek (Apple-style), not a cover takeover.
 */
export function SkillCountPeek({ label, slugs }: { label: string; slugs: string[] }) {
  if (slugs.length === 0) return <>{label}</>
  const shown = slugs.slice(0, 8)
  const extra = slugs.length - shown.length
  return (
    <Tooltip
      side="top"
      align="start"
      content={
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-(--ink-2)">Inside</p>
          <ul className="mt-1 space-y-0.5">
            {shown.map((s) => (
              <li key={s} className="font-mono text-xs text-(--ink)">
                {s}
              </li>
            ))}
          </ul>
          {extra > 0 && <p className="mt-1 font-mono text-xs text-(--ink-2)">+{extra} more</p>}
        </div>
      }
    >
      <span className="cursor-default underline decoration-white/40 decoration-dotted underline-offset-2">
        {label}
      </span>
    </Tooltip>
  )
}
