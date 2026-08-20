'use client'

import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

/**
 * Share controls for a blog post: copy the canonical link, or open a prefilled
 * post on X. Two affordances on purpose. A row of network buttons is mostly
 * dead weight, and the link is what people actually pass around.
 *
 * The URL passed in is the post's canonical, so a shared link never carries a
 * tracking suffix or a non-canonical host.
 */
export function PostShare({ url, title }: { url: string; title: string }) {
  const { copied, copy } = useCopyToClipboard()
  const shareHref = `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => copy(url)}
        className="rounded-full border border-(--line) px-3.5 py-1.5 text-sm text-(--ink-2) transition-colors hover:border-(--accent) hover:text-(--ink)"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <a
        href={shareHref}
        target="_blank"
        // noopener keeps the opened tab from reaching back through window.opener.
        rel="noopener noreferrer"
        className="rounded-full border border-(--line) px-3.5 py-1.5 text-sm text-(--ink-2) transition-colors hover:border-(--accent) hover:text-(--ink)"
      >
        Share on X
      </a>
    </div>
  )
}
