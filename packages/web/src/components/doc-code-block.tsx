'use client'

import { useRef } from 'react'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

export function DocCodeBlock({
  language,
  children,
}: {
  language?: string
  children: React.ReactNode
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const { copied, copy } = useCopyToClipboard()

  function handleCopy() {
    const text = preRef.current?.textContent ?? ''
    void copy(text.trim())
  }

  return (
    <div className="docs-code-block group relative my-5 overflow-hidden rounded-lg border border-(--code-border)">
      {language && (
        <div className="border-b border-(--code-border) bg-(--code-header-bg) px-4 py-1.5">
          <span className="font-mono text-xs text-(--code-chrome)">{language}</span>
        </div>
      )}
      <pre ref={preRef} className="overflow-x-auto bg-(--code-bg) px-5 py-4 text-sm leading-relaxed">
        <code className="font-mono">{children}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
        className="absolute right-3 top-[calc(50%_-_14px)] flex h-7 items-center gap-1.5 rounded border border-(--code-border) bg-(--code-header-bg) px-2.5 text-xs text-(--code-chrome) opacity-0 transition-opacity group-hover:opacity-100 hover:bg-(--code-border) hover:text-(--ink)"
      >
        {copied ? (
          <>
            <svg width="11" height="11" fill="none" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2 6l3 3 5-5"
                stroke="#4ade80"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="11" height="11" fill="none" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="4"
                y="4"
                width="7"
                height="7"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M8 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  )
}
