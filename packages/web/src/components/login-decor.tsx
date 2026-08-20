import { Avatar } from '@/components/ui/avatar'
import { ClaudeLogo, CursorLogo, HermesLogo, OpenAiLogo, OpenClawLogo } from '@/components/brand-logos'

/**
 * Friendly illustrated faces sprinkled across the canvas. These are the
 * generated default avatars (deterministic per seed) — never real photos or
 * brand logos, so the decor stays soft and on-brand, makes no claim about who
 * uses Skillet, and can't borrow credibility from unclaimed mirrors. Positions
 * stay out of the centered title/flow band and lean to the outer thirds +
 * top/bottom so nothing sits behind reading text; the card's own surface covers
 * anything behind it. Bottom slots are anchored flush to the edge so the clip
 * line lands on the footer rule. Purely ambient and aria-hidden. Hidden on
 * mobile, where there's no room beside the form.
 */
type Slot = { seed: string; pos: string; size: 'sm' | 'md' | 'lg' }

const SCATTER: Slot[] = [
  // upper hero — outer thirds only (the title/card/agent text sit centered up top)
  { seed: 'ada', pos: 'left-[8%] top-[9%]', size: 'sm' },
  { seed: 'milo', pos: 'left-[19%] top-[24%]', size: 'sm' },
  { seed: 'june', pos: 'right-[9%] top-[8%]', size: 'sm' },
  { seed: 'theo', pos: 'right-[18%] top-[22%]', size: 'md' },
  // mid sides — clipped at the edges, flanking the card
  { seed: 'noor', pos: 'left-[-16px] top-[40%]', size: 'lg' },
  { seed: 'rosa', pos: 'right-[-18px] top-[44%]', size: 'lg' },
  // lower canvas — bottom-anchored, floating above the line at varied heights
  { seed: 'kai', pos: 'left-[6%] bottom-[24%]', size: 'md' },
  { seed: 'nina', pos: 'right-[9%] bottom-[27%]', size: 'sm' },
  { seed: 'luca', pos: 'right-[26%] bottom-[14%]', size: 'sm' },
  // just three clipped on the footer rule — spread + varied so it reads sprinkled,
  // not like a regimented row of half-heads
  { seed: 'wren', pos: 'left-[13%] bottom-[-16px]', size: 'lg' },
  { seed: 'otis', pos: 'left-[49%] bottom-[-10px]', size: 'sm' },
  { seed: 'remy', pos: 'right-[15%] bottom-[-16px]', size: 'lg' },
]

export function LoginScatterAvatars() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden opacity-65 sm:block">
      {SCATTER.map((slot) => (
        <span key={slot.seed} className={`absolute ${slot.pos}`}>
          <Avatar name={slot.seed} colorKey={slot.seed} size={slot.size} className="ring-2 ring-(--bg)" />
        </span>
      ))}
    </div>
  )
}

/** The agents Skillet syncs to — every agent mark we ship. */
const AGENT_LOGOS = [ClaudeLogo, OpenAiLogo, CursorLogo, OpenClawLogo, HermesLogo]

/**
 * Honest day-one trust below the card: real agent marks, with the three true,
 * categorical claims on one line beneath them. No people face-pile (it borrowed
 * credibility from unclaimed mirrors), no count — just compatibility and the
 * license/price facts. Apache-licensed, free, and yours to run anywhere.
 */
export function LoginAgentCompat() {
  return (
    <div className="mt-12 flex flex-col items-center gap-3">
      <div className="flex items-center -space-x-2">
        {AGENT_LOGOS.map((Logo, i) => (
          <span
            key={i}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-(--line) bg-(--surface) p-2 text-(--ink) ring-2 ring-(--bg)"
          >
            <Logo className="h-full w-full" />
          </span>
        ))}
      </div>
      <p className="text-sm text-(--ink-2)">Free · Open source · Works with every agent</p>
    </div>
  )
}
