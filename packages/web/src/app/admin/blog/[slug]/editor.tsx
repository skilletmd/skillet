'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { Post, PostStatus } from '@/lib/blog'
import { Button } from '@/components/ui/button'
import { savePost } from '../actions'
import 'highlight.js/styles/github.css'

type Props = { post: Post; saved: boolean }
type Mode = 'write' | 'preview'

const PROSE_CLS =
  'prose-body text-lg leading-[1.7] text-(--ink) ' +
  '[&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight ' +
  '[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight ' +
  '[&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold ' +
  '[&_hr]:my-8 [&_hr]:border-(--line) ' +
  '[&_p]:mb-5 ' +
  '[&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ul>li]:mb-1 ' +
  '[&_ol]:mb-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol>li]:mb-1 ' +
  '[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-(--line) [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-(--ink-2) ' +
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:border [&_:not(pre)>code]:border-(--line) [&_:not(pre)>code]:bg-(--surface) [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-sm ' +
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-(--line) [&_pre]:p-4 [&_pre]:text-sm ' +
  '[&_a]:text-(--accent) [&_a]:underline-offset-2 hover:[&_a]:underline ' +
  '[&_strong]:font-semibold ' +
  '[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse ' +
  '[&_th]:border [&_th]:border-(--line) [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold ' +
  '[&_td]:border [&_td]:border-(--line) [&_td]:px-3 [&_td]:py-2'

marked.setOptions({ gfm: true, breaks: false })

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    fence: '```',
    hr: '---',
    linkStyle: 'inlined',
  })
  td.use(gfm)
  return td
}

function md2html(src: string): string {
  return marked.parse(src, { async: false }) as string
}

export function Editor({ post, saved }: Props) {
  const [title, setTitle] = useState(post.title)
  const [description, setDescription] = useState(post.description)
  const [publishedAt, setPublishedAt] = useState(post.publishedAt ?? '')
  const [tags, setTags] = useState(post.tags.join(', '))
  const [body, setBody] = useState(post.content)
  const [status, setStatus] = useState<PostStatus>(post.status)
  const [mode, setMode] = useState<Mode>('write')
  const [pending, startTransition] = useTransition()
  const previewRef = useRef<HTMLDivElement | null>(null)
  const td = useMemo(makeTurndown, [])

  // Only re-render on mode flip — not on every body keystroke — so the cursor
  // never jumps while the user is typing inside the preview surface.
  useEffect(() => {
    if (mode !== 'preview') return
    const el = previewRef.current
    if (!el) return
    el.innerHTML = md2html(body)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncPreviewToBody = useCallback((): string => {
    const el = previewRef.current
    if (!el) return body
    const md = td.turndown(el.innerHTML).trim() + '\n'
    setBody(md)
    return md
  }, [body, td])

  function setModeAndSync(next: Mode) {
    if (next === mode) return
    if (mode === 'preview') syncPreviewToBody()
    setMode(next)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    if (mode === 'preview') {
      form.set('body', syncPreviewToBody())
    }
    startTransition(async () => {
      await savePost(post.slug, form)
    })
  }

  const wordCount = useMemo(() => {
    const w = body.trim().split(/\s+/).filter(Boolean).length
    return w
  }, [body])

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-[760px] px-5 pt-8 pb-24 sm:px-8">
      {/* Top bar */}
      <div className="mb-10 flex items-center gap-3 text-sm text-(--ink-2)">
        <Link href="/admin/blog" className="shrink-0 whitespace-nowrap hover:text-(--ink)">
          ← All posts
        </Link>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <span className="hidden truncate font-mono text-xs sm:inline">{post.slug}</span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {saved && (
            <span className="text-(--ink-2)" role="status">
              Saved
            </span>
          )}
          <Link
            href={`/blog/${post.slug}`}
            target="_blank"
            rel="noopener"
            className="hover:text-(--ink)"
          >
            View
          </Link>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Title — borderless, looks like a heading */}
      <label className="sr-only" htmlFor="post-title">
        Title
      </label>
      <input
        id="post-title"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="block w-full border-0 bg-transparent p-0 text-3xl font-bold leading-[1.15] tracking-tight text-(--ink) placeholder:text-(--ink-2)/40 focus:outline-none sm:text-4xl"
      />

      {/* Description — borderless subtitle */}
      <label className="sr-only" htmlFor="post-description">
        Description
      </label>
      <input
        id="post-description"
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add a description"
        className="mt-3 block w-full border-0 bg-transparent p-0 text-lg leading-[1.5] text-(--ink-2) placeholder:text-(--ink-2)/40 focus:outline-none"
      />

      {/* Quiet meta row */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-(--ink-2)">
        <label className="flex items-center gap-1.5">
          <span className="text-(--ink-2)/70">Status</span>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PostStatus)}
            className="border-0 bg-transparent p-0 pr-3 text-(--ink) focus:outline-none"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-(--ink-2)/70">Date</span>
          <input
            name="publishedAt"
            value={publishedAt}
            onChange={(e) => setPublishedAt(e.target.value)}
            placeholder="YYYY-MM-DD"
            size={11}
            className="w-[10ch] border-0 bg-transparent p-0 text-(--ink) placeholder:text-(--ink-2)/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-1 items-center gap-1.5 min-w-[180px]">
          <span className="text-(--ink-2)/70">Tags</span>
          <input
            name="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="skills, teams"
            className="w-full border-0 bg-transparent p-0 text-(--ink) placeholder:text-(--ink-2)/40 focus:outline-none"
          />
        </label>
      </div>

      {/* Toggle + counter */}
      <div className="mt-8 flex items-center justify-between border-y border-(--line) py-2">
        <div
          role="tablist"
          aria-label="Editor mode"
          className="flex items-center rounded-md bg-(--surface) p-0.5 text-xs font-medium"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            onClick={() => setModeAndSync('write')}
            className={`rounded px-2.5 py-1 transition-colors ${
              mode === 'write'
                ? 'bg-(--bg) text-(--ink) shadow-[0_0_0_1px_var(--line)]'
                : 'text-(--ink-2) hover:text-(--ink)'
            }`}
          >
            Markdown
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            onClick={() => setModeAndSync('preview')}
            className={`rounded px-2.5 py-1 transition-colors ${
              mode === 'preview'
                ? 'bg-(--bg) text-(--ink) shadow-[0_0_0_1px_var(--line)]'
                : 'text-(--ink-2) hover:text-(--ink)'
            }`}
          >
            Preview
          </button>
        </div>
        <div className="text-xs text-(--ink-2)/70 tabular-nums">
          {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
        </div>
      </div>

      {/* Single editing surface */}
      <div className="mt-6">
        {/* Markdown: hidden when in preview but kept mounted to preserve native textarea state */}
        <div className={mode === 'write' ? 'block' : 'hidden'}>
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            placeholder="Start writing markdown…"
            className="block min-h-[60vh] w-full resize-y border-0 bg-transparent p-0 font-mono text-sm leading-[1.7] text-(--ink) placeholder:text-(--ink-2)/40 focus:outline-none"
          />
        </div>

        {mode === 'preview' && (
          <div
            ref={previewRef}
            role="textbox"
            aria-multiline="true"
            aria-label="Rendered editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            className={`${PROSE_CLS} min-h-[60vh] focus:outline-none`}
          />
        )}
      </div>

      {/* Status pill in a quiet footer to mirror Notion's bottom-of-page status */}
      <div className="mt-10 flex items-center justify-between text-xs text-(--ink-2)/70">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 ${
            status === 'published'
              ? 'text-(--success) bg-(--success-bg)'
              : 'text-(--ink-2) bg-(--surface)'
          }`}
        >
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${
              status === 'published' ? 'bg-(--success-line)' : 'bg-(--ink-2)/40'
            }`}
          />
          {status === 'published' ? 'Published' : 'Draft'}
        </span>
        <span className="font-mono">{post.slug}.md</span>
      </div>
    </form>
  )
}
