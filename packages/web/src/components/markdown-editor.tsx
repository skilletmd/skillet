'use client'

import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { pluralize } from '@/lib/format'

export type MarkdownEditorMode = 'edit' | 'split' | 'preview'
export type MarkdownEditorStatus = 'draft' | 'published'

export interface MarkdownEditorFrontmatter {
  title: string
  /** Optional `<title>` override; blank means "use the headline". */
  seoTitle?: string
  description: string
  publishedAt: string | null
  status: MarkdownEditorStatus
  tags: string[]
  /**
   * Cited sources, for a post tagged `story`. Edited as one JSON block rather
   * than a row builder: a story carries a handful of sources, they are pasted
   * from the collector's output, and a textarea round-trips that in one step.
   */
  sourcesJson?: string
  /** Story kicker: launch, labs, research, debate, trust. */
  storyKind?: string
}

interface MarkdownEditorProps {
  value: string
  frontmatter: MarkdownEditorFrontmatter
  onChange: (content: string, frontmatter: MarkdownEditorFrontmatter) => void
  onSave?: () => void | Promise<void>
  storageKey?: string
}

interface DraftPayload {
  value: string
  frontmatter: MarkdownEditorFrontmatter
}

const toolbarItems = [
  { label: 'B', title: 'Bold', before: '**', after: '**', fallback: 'bold text' },
  { label: 'I', title: 'Italic', before: '_', after: '_', fallback: 'italic text' },
  { label: 'Link', title: 'Link', before: '[', after: '](https://)', fallback: 'link text' },
  {
    label: 'Code',
    title: 'Code block',
    before: '```ts\n',
    after: '\n```',
    fallback: 'const value = true;',
  },
  { label: 'Image', title: 'Image', before: '![', after: '](https://)', fallback: 'alt text' },
]

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function estimateReadTime(words: number): number {
  return Math.max(1, Math.ceil(words / 200))
}

function normalizeTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

function isDraftPayload(value: unknown): value is DraftPayload {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<DraftPayload>
  const frontmatter = draft.frontmatter as Partial<MarkdownEditorFrontmatter> | undefined
  return (
    typeof draft.value === 'string' &&
    !!frontmatter &&
    typeof frontmatter.title === 'string' &&
    typeof frontmatter.description === 'string' &&
    (frontmatter.publishedAt === null || typeof frontmatter.publishedAt === 'string') &&
    (frontmatter.status === 'draft' || frontmatter.status === 'published') &&
    Array.isArray(frontmatter.tags)
  )
}

export function MarkdownEditor({
  value,
  frontmatter,
  onChange,
  onSave,
  storageKey,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>('edit')
  const [tagsInput, setTagsInput] = useState(frontmatter.tags.join(', '))
  const [draftRestored, setDraftRestored] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hydratedRef = useRef(false)
  const onChangeRef = useRef(onChange)

  const words = useMemo(() => countWords(value), [value])
  const readTime = useMemo(() => estimateReadTime(words), [words])
  const showEditor = mode !== 'preview'
  const showPreview = mode !== 'edit'

  useEffect(() => {
    if (!tagsEqual(normalizeTags(tagsInput), frontmatter.tags)) {
      setTagsInput(frontmatter.tags.join(', '))
    }
  }, [frontmatter.tags, tagsInput])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!storageKey) {
      hydratedRef.current = true
      return
    }

    const raw = window.localStorage.getItem(storageKey)
    if (raw) {
      try {
        const draft: unknown = JSON.parse(raw)
        if (isDraftPayload(draft)) {
          onChangeRef.current(draft.value, draft.frontmatter)
          setDraftRestored(true)
        }
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    }

    hydratedRef.current = true
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || !hydratedRef.current) return
    const payload: DraftPayload = { value, frontmatter }
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  }, [frontmatter, storageKey, value])

  function updateFrontmatter(next: Partial<MarkdownEditorFrontmatter>) {
    onChange(value, { ...frontmatter, ...next })
  }

  function applyToolbarItem(item: (typeof toolbarItems)[number]) {
    const textarea = textareaRef.current
    const selectedStart = textarea?.selectionStart ?? value.length
    const selectedEnd = textarea?.selectionEnd ?? value.length
    const selected = value.slice(selectedStart, selectedEnd) || item.fallback
    const next = `${value.slice(0, selectedStart)}${item.before}${selected}${item.after}${value.slice(selectedEnd)}`

    onChange(next, frontmatter)

    requestAnimationFrame(() => {
      textarea?.focus()
      const cursorStart = selectedStart + item.before.length
      const cursorEnd = cursorStart + selected.length
      textarea?.setSelectionRange(cursorStart, cursorEnd)
    })
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      await onSave?.()
    }
  }

  return (
    <section className="overflow-hidden rounded border border-(--line) bg-(--surface)">
      <div className="grid gap-4 border-b border-(--line) p-4 md:grid-cols-2">
        <label className="block text-sm font-medium">
          Title
          <input
            className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            value={frontmatter.title}
            onChange={(event) => updateFrontmatter({ title: event.target.value })}
          />
        </label>
        <label className="block text-sm font-medium">
          Published date
          <input
            className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            placeholder="YYYY-MM-DD"
            value={frontmatter.publishedAt ?? ''}
            onChange={(event) => updateFrontmatter({ publishedAt: event.target.value || null })}
          />
        </label>
        <label className="block text-sm font-medium md:col-span-2">
          SEO title
          <input
            className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            placeholder="Leave blank to use the headline"
            value={frontmatter.seoTitle ?? ''}
            onChange={(event) => updateFrontmatter({ seoTitle: event.target.value })}
          />
        </label>
        <label className="block text-sm font-medium md:col-span-2">
          Description
          <textarea
            className="mt-1 min-h-20 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            value={frontmatter.description}
            onChange={(event) => updateFrontmatter({ description: event.target.value })}
          />
        </label>
        <label className="block text-sm font-medium">
          Tags
          <input
            className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            placeholder="skills, product"
            value={tagsInput}
            onChange={(event) => {
              setTagsInput(event.target.value)
              updateFrontmatter({ tags: normalizeTags(event.target.value) })
            }}
          />
        </label>
        {/* Story fields appear only on a post tagged `story`, so ordinary blog
            authoring is untouched by them. */}
        {frontmatter.tags.includes('story') ? (
          <>
            <label className="block text-sm font-medium">
              Story kind
              <select
                className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
                value={frontmatter.storyKind ?? 'story'}
                onChange={(event) => updateFrontmatter({ storyKind: event.target.value })}
              >
                <option value="story">Story</option>
                <option value="launch">Launch</option>
                <option value="labs">From the labs</option>
                <option value="research">Research</option>
                <option value="debate">The argument</option>
                <option value="trust">Trust</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Sources
              <span className="mt-0.5 block text-xs font-normal text-(--ink-2)">
                A story&rsquo;s credibility is its sources. Every entry needs a network (x, hn,
                reddit, web), a handle and a url; publishing fails otherwise.
              </span>
              <textarea
                className="mt-1 min-h-32 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 font-mono text-xs outline-none transition focus:border-(--accent)"
                placeholder={'[\n  {"network":"x","handle":"tobi","label":"Tobi Lütke","detail":"621K views","url":"https://x.com/…"}\n]'}
                value={frontmatter.sourcesJson ?? ''}
                onChange={(event) => updateFrontmatter({ sourcesJson: event.target.value })}
              />
            </label>
          </>
        ) : null}
        <label className="block text-sm font-medium">
          Status
          <select
            className="mt-1 w-full rounded border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none transition focus:border-(--accent)"
            value={frontmatter.status}
            onChange={(event) =>
              updateFrontmatter({ status: event.target.value as MarkdownEditorStatus })
            }
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--line) px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {toolbarItems.map((item) => (
            <Button
              key={item.title}
              variant="secondary"
              size="sm"
              type="button"
              title={item.title}
              aria-label={item.title}
              onClick={() => applyToolbarItem(item)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="inline-flex rounded border border-(--line) bg-(--bg) p-0.5 text-xs font-semibold">
          {(['edit', 'split', 'preview'] as MarkdownEditorMode[]).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              className={`rounded px-3 py-1.5 capitalize transition ${
                mode === nextMode ? 'bg-(--accent) text-(--surface)' : 'text-(--ink-2) hover:text-(--ink)'
              } ${nextMode === 'split' ? 'hidden sm:inline-block' : ''}`}
              onClick={() => setMode(nextMode)}
            >
              {nextMode}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`grid min-h-[520px] ${
          mode === 'split' ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''
        }`}
      >
        {showEditor && (
          <div className={mode === 'split' ? '' : showPreview ? 'hidden' : ''}>
            <textarea
              ref={textareaRef}
              className="block h-full min-h-[520px] w-full resize-y bg-(--bg) p-4 font-mono text-sm leading-6 text-(--ink) outline-none lg:resize-none"
              value={value}
              onChange={(event) => onChange(event.target.value, frontmatter)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
          </div>
        )}
        {showPreview && (
          <div
            className={`min-h-[520px] overflow-auto p-5 ${
              mode === 'split' ? 'hidden border-l border-(--line) lg:block' : ''
            }`}
          >
            <MarkdownContent content={value || '_Nothing to preview yet._'} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--line) px-4 py-2 text-xs text-(--ink-2)">
        <span>
          {words} {pluralize(words, 'word')} · {readTime} min read
        </span>
        <span>{draftRestored ? 'Local draft restored and autosaving' : 'Autosaving locally'}</span>
      </div>
    </section>
  )
}
