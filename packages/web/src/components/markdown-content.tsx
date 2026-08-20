import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { AppLink, isSafeUntrustedHref } from '@/components/app-link'
import { BundleImage } from '@/components/bundle-image'

// Shared across both scales — structural treatment that doesn't change with size.
// `break-words`: an unbreakable inline run (a long URL, code chips joined by
// slashes) wraps at the container edge instead of forcing the whole document
// pane into horizontal scroll. Only applies when a line would overflow.
const sharedMarkdownClassName = `
  blog-markdown docs-content break-words text-(--ink)
  [&_hr]:border-(--line)
  [&_ul]:list-disc [&_ul]:pl-6
  [&_ol]:list-decimal [&_ol]:pl-6
  [&_blockquote]:border-l-2 [&_blockquote]:border-(--line) [&_blockquote]:pl-4 [&_blockquote]:text-(--ink-2) [&_blockquote]:italic
  [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-(--surface) [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:border [&_:not(pre)>code]:border-(--line)
  [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-(--line)
  [&_a]:text-(--accent) [&_a]:underline-offset-2 hover:[&_a]:underline
  [&_strong]:font-semibold
  [&_table]:min-w-full [&_table]:border-collapse
  [&_th]:border-b [&_th]:border-(--line) [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:align-top [&_th]:font-semibold
  [&_td]:border-b [&_td]:border-(--line) [&_td]:px-3 [&_td]:py-2 [&_td]:align-top
`

// Article scale: full-page blog reading. Generous type and rhythm.
const articleMarkdownClassName = `
  text-lg leading-[1.7]
  [&_h1]:mb-4 [&_h1]:mt-0 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:tracking-tight
  [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em]
  [&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold
  [&_hr]:my-8
  [&_p]:mb-5
  [&_ul]:mb-5 [&_ul>li]:mb-1
  [&_ol]:mb-5 [&_ol>li]:mb-1
  [&_blockquote]:my-5
  [&_:not(pre)>code]:text-base
  [&_pre]:my-6 [&_pre]:p-5 [&_pre]:text-sm
  [&_table]:text-base
`

// Compact scale: reference content inside a contained viewer (skill file preview).
// Denser type and tighter rhythm so a SKILL.md reads as a doc, not an article.
const compactMarkdownClassName = `
  text-sm leading-[1.65]
  [&_h1]:mb-3 [&_h1]:mt-0 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-tight
  [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-[-0.01em]
  [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold
  [&_hr]:my-6
  [&_p]:mb-4
  [&_ul]:mb-4 [&_ul>li]:mb-1
  [&_ol]:mb-4 [&_ol>li]:mb-1
  [&_blockquote]:my-4
  [&_:not(pre)>code]:text-xs
  [&_pre]:my-4 [&_pre]:p-4 [&_pre]:text-xs
  [&_table]:text-sm
`

export function MarkdownContent({
  content,
  className = '',
  variant = 'article',
  resolveImageSrc,
}: {
  content: string
  className?: string
  /** `article` = full-page blog scale; `compact` = denser file-preview scale. */
  variant?: 'article' | 'compact'
  /**
   * Skill-file-viewer only: maps a RELATIVE image src to a fetchable URL, or
   * null to render nothing (unresolvable refs must not leave a broken-image
   * icon). Absolute http(s) srcs bypass it and render as always. Omitted —
   * blog, docs — markdown images render exactly as before.
   */
  resolveImageSrc?: (src: string) => string | null
}) {
  const scale = variant === 'compact' ? compactMarkdownClassName : articleMarkdownClassName
  return (
    <article className={`${sharedMarkdownClassName} ${scale} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Code-block syntax highlighting. highlight.js/lowlight are externalized
        // in next.config (serverExternalPackages) so their internal require works
        // under Turbopack dynamic SSR instead of throwing "require is not defined".
        rehypePlugins={[rehypeHighlight]}
        // Drop raw HTML nodes entirely. Without this, react-markdown renders
        // them as escaped literal TEXT — `<!-- generator comments -->` and
        // stray `<img>` tags show up as prose in the viewer. Escaped entities
        // (&lt;) written by an author still render as text.
        skipHtml
        components={{
          a({ href, children }) {
            if (!href || !isSafeUntrustedHref(href)) return <span>{children}</span>
            return <AppLink href={href}>{children}</AppLink>
          },
          // Wide tables scroll inside their own box instead of dragging the
          // whole document sideways and clipping the prose.
          table({ children }) {
            return (
              <div className="my-6 overflow-x-auto">
                <table>{children}</table>
              </div>
            )
          },
          ...(resolveImageSrc
            ? {
                img({ src, alt }: { src?: unknown; alt?: string }) {
                  if (typeof src !== 'string' || src.length === 0) return null
                  // Remote images keep today's behavior (CSP governs them).
                  if (/^https?:\/\//i.test(src)) return <img src={src} alt={alt ?? ''} />
                  const resolved = resolveImageSrc(src)
                  if (resolved == null) return null
                  return <BundleImage src={resolved} alt={alt ?? ''} />
                },
              }
            : {}),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
