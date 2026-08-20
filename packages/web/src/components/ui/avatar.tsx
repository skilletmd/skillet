import { cva, type VariantProps } from 'class-variance-authority'
import Image from 'next/image'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { avatarInitials, resolveAvatar } from '@/lib/avatar-color'
import { isOptimizableImageHost } from '@/lib/image-hosts'

/** Rendered box per size, in CSS px — the intrinsic size we hand next/image so
 *  it generates a 1×/2× srcset at the right resolution. lg uses its
 *  sm-breakpoint size so the larger render stays crisp. */
const SIZE_PX = { xxs: 20, xs: 24, sm: 34, md: 40, lg: 84, xl: 224 } as const

/**
 * The shared user/owner avatar — the single authority on how an identity is
 * drawn, so they can never drift apart (the GR-vs-G and "feed colored, profile
 * plain" bugs). Two kinds:
 *   • person (default): a circle. Uploaded photo, else a hand-drawn illustrated
 *     default face (deterministic per handle) on a soft per-person tint.
 *   • team: a rounded-square (the org convention — reads as not-a-person at a
 *     glance). Uploaded logo, else an initials monogram on the tint. Teams never
 *     get a human face.
 * Pass `tone="plain"` for the rare surface that wants a quiet bordered initial.
 */
const avatar = cva(
  'inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-mono font-bold leading-none',
  {
    variants: {
      size: {
        xxs: 'h-5 w-5 text-2xs',
        xs: 'h-6 w-6 text-2xs',
        sm: 'h-[34px] w-[34px] text-xs',
        md: 'h-10 w-10 text-sm',
        lg: 'h-[68px] w-[68px] text-xl sm:h-[84px] sm:w-[84px] sm:text-2xl',
        xl: 'h-56 w-56 text-4xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

type AvatarProps = Omit<ComponentProps<'span'>, 'children'> &
  VariantProps<typeof avatar> & {
    /** Avatar image URL; falls back to the illustrated default / monogram. */
    src?: string | null
    /** Display name or handle — drives the monogram and image alt. */
    name: string
    /**
     * Stable key for the tint hue / default face. Pass the immutable handle so
     * the same identity looks the same everywhere. Defaults to `name`.
     */
    colorKey?: string
    /** `person` (circle + face) or `team` (rounded-square + monogram). */
    kind?: 'person' | 'team'
    /** `plain` swaps the tint for a quiet bordered initial. */
    tone?: 'color' | 'plain'
    /** Mark the one above-the-fold LCP avatar on a page so it loads eagerly. */
    priority?: boolean
    /**
     * Rendered-width hint for a fluid avatar (one whose className overrides the
     * size box, e.g. the profile rail). Without it next/image only ships a
     * srcset for the fixed `size` box, so a fluid avatar renders upscaled.
     */
    sizes?: string
  }

export function Avatar({
  src,
  name,
  colorKey,
  size,
  kind = 'person',
  tone = 'color',
  priority = false,
  sizes,
  className,
  style,
  ...props
}: AvatarProps) {
  const { photo, faceUrl, background, isTeam } = resolveAvatar(src, colorKey ?? name, kind)
  const shape = isTeam ? 'rounded-[28%]' : 'rounded-full'
  const px = SIZE_PX[size ?? 'md']

  // An uploaded photo or external logo: fill the frame, cover-fit. Known
  // provider hosts get optimized; any other host passes through unoptimized
  // (same bytes as before, no allowlist needed) — see lib/image-hosts.
  if (photo) {
    return (
      <span
        className={cn(avatar({ size }), shape, className)}
        style={style}
        {...props}
      >
        <Image
          src={photo}
          alt={name}
          width={px}
          height={px}
          unoptimized={!isOptimizableImageHost(photo)}
          priority={priority}
          sizes={sizes}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      </span>
    )
  }

  if (tone === 'plain') {
    return (
      <span
        className={cn(
          avatar({ size }),
          shape,
          'border border-(--line) bg-(--bg) text-(--ink-2)',
          className,
        )}
        style={style}
        {...props}
      >
        {avatarInitials(name)}
      </span>
    )
  }

  // Team with no logo: an initials monogram on the tint (never a human face).
  // The tint stays light in both themes (see avatar-color.ts) so the pure-black
  // line-art faces never vanish, so the monogram is a fixed dark too — not
  // `--ink`, which would flip light in dark mode and wash out on the pastel.
  if (faceUrl == null) {
    return (
      <span
        className={cn(avatar({ size }), shape, 'text-black/80', className)}
        style={{ background, ...style }}
        {...props}
      >
        {avatarInitials(name)}
      </span>
    )
  }

  // Person: the illustrated default face (or an explicitly chosen one) on tint.
  // Local SVG — render unoptimized (the optimizer skips SVGs by default and they
  // gain nothing from it); next/image still gives lazy-loading for free.
  return (
    <span
      className={cn(avatar({ size }), shape, className)}
      style={{ background, ...style }}
      {...props}
    >
      <Image
        src={faceUrl}
        alt={name}
        width={px}
        height={px}
        unoptimized
        priority={priority}
        sizes={sizes}
        className="h-full w-full object-cover"
      />
    </span>
  )
}
