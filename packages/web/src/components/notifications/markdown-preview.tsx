import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * The react-markdown stack, isolated into its own chunk so it's only fetched
 * when a notification's "What changed" panel actually renders markdown — not on
 * every feed/notifications load. Imported lazily via next/dynamic from
 * {@link ./update-card}.
 */
export default function MarkdownPreview({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
}
