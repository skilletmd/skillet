'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { AppLink } from './app-link'
import { DocCodeBlock } from './doc-code-block'
import { panelHues } from '@/lib/docs-panel'

type CalloutType = 'tip' | 'note' | 'warning'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '')
}

function Callout({ type, children }: { type: CalloutType; children: React.ReactNode }) {
  const config: Record<
    CalloutType,
    { borderColor: string; bg: string; label: string; labelColor: string }
  > = {
    tip: {
      borderColor: 'var(--accent)',
      bg: 'var(--accent-bg)',
      label: 'Tip',
      labelColor: 'var(--accent)',
    },
    warning: {
      borderColor: 'var(--danger)',
      bg: 'color-mix(in srgb, var(--danger) 8%, var(--bg))',
      label: 'Warning',
      labelColor: 'var(--danger)',
    },
    note: {
      borderColor: 'var(--ink-2)',
      bg: 'var(--surface)',
      label: 'Note',
      labelColor: 'var(--ink-2)',
    },
  }
  const c = config[type]

  return (
    <div
      className="my-5 rounded-r-lg border-l-4 px-5 py-4"
      style={{ borderColor: c.borderColor, backgroundColor: c.bg }}
    >
      <p
        className="mb-1.5 text-xs font-semibold uppercase tracking-wider"
        style={{ color: c.labelColor }}
      >
        {c.label}
      </p>
      <div className="text-sm leading-relaxed text-(--ink)">{children}</div>
    </div>
  )
}

function makeId(children: React.ReactNode): string {
  return slugify(String(children))
}

interface BlockquoteProps {
  children?: React.ReactNode
}

function DocBlockquote({ children }: BlockquoteProps) {
  const arr = React.Children.toArray(children)
  const first = arr[0]

  if (React.isValidElement(first) && first.type === 'p') {
    const pEl = first as React.ReactElement<{ children?: React.ReactNode }>
    const pChildren = React.Children.toArray(pEl.props.children)

    if (pChildren.length === 1) {
      const only = pChildren[0]
      if (React.isValidElement(only) && (only as React.ReactElement).type === 'strong') {
        const strongEl = only as React.ReactElement<{ children?: React.ReactNode }>
        const label = String(strongEl.props.children).toLowerCase().trim()
        if (label === 'tip' || label === 'note' || label === 'warning') {
          return <Callout type={label as CalloutType}>{arr.slice(1)}</Callout>
        }
      }
    }
  }

  return (
    <blockquote className="my-5 border-l-4 border-(--line) pl-4 italic text-(--ink-2)">
      {children}
    </blockquote>
  )
}

export function DocContent({ content }: { content: string }) {
  // Strip HTML comments (e.g. the `<!-- cli-commands:start -->` codegen markers).
  // They must stay in the source .md for the generator, but react-markdown would
  // otherwise render them as visible text.
  const rendered = content.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n')
  return (
    <div className="docs-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1({ children }) {
            const id = makeId(children)
            return (
              <h1 id={id} className="mb-4 mt-0 text-3xl font-bold tracking-tight text-(--ink)">
                {children}
              </h1>
            )
          },
          h2({ children }) {
            const id = makeId(children)
            return (
              <h2 id={id} className="mb-3 mt-10 text-xl font-semibold text-(--ink)">
                {children}
              </h2>
            )
          },
          h3({ children }) {
            const id = makeId(children)
            return (
              <h3 id={id} className="mb-2 mt-6 text-base font-semibold text-(--ink)">
                {children}
              </h3>
            )
          },
          p({ children }) {
            return <p className="my-4 leading-relaxed text-(--ink-2)">{children}</p>
          },
          a({ href, children }) {
            if (!href) return <>{children}</>
            return (
              <AppLink
                href={href}
                className="font-medium text-(--accent) underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </AppLink>
            )
          },
          img({ src, alt }) {
            if (typeof src !== 'string') return null
            const hues = panelHues(src.split('/').pop() || src)
            return (
              <span
                className="docs-img-panel my-7 flex justify-center rounded-2xl px-6 py-5"
                style={{ '--g1': hues.g1, '--g2': hues.g2 } as React.CSSProperties}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={alt || ''} className="docs-hero-art max-h-[180px] w-auto" />
              </span>
            )
          },
          ul({ children }) {
            return (
              <ul
                className="my-4 space-y-1.5 pl-6 text-(--ink-2)"
                style={{ listStyleType: 'disc' }}
              >
                {children}
              </ul>
            )
          },
          ol({ children }) {
            return (
              <ol
                className="my-4 space-y-1.5 pl-6 text-(--ink-2)"
                style={{ listStyleType: 'decimal' }}
              >
                {children}
              </ol>
            )
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>
          },
          table({ children }) {
            return (
              <div className="my-5 overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return (
              <thead className="border-b border-(--line) text-left text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                {children}
              </thead>
            )
          },
          th({ children }) {
            return <th className="py-2 pr-6">{children}</th>
          },
          td({ children }) {
            return (
              <td className="border-b border-(--line) py-2.5 pr-6 text-(--ink-2)">{children}</td>
            )
          },
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || '')
            if (!match) {
              return (
                <code className="whitespace-nowrap rounded border border-(--line) bg-(--surface) px-1 py-0.5 font-mono code-inline text-(--ink)">
                  {children}
                </code>
              )
            }
            return <DocCodeBlock language={match[1]}>{children}</DocCodeBlock>
          },
          pre({ children }) {
            // DocCodeBlock provides the pre wrapper; just pass through
            return <>{children}</>
          },
          blockquote({ children }) {
            return <DocBlockquote>{children}</DocBlockquote>
          },
          hr() {
            return <hr className="my-8 border-(--line)" />
          },
          strong({ children }) {
            return <strong className="font-semibold text-(--ink)">{children}</strong>
          },
          em({ children }) {
            return <em className="italic">{children}</em>
          },
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  )
}
