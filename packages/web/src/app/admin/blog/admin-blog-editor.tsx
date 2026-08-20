'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'
import { MarkdownEditor, type MarkdownEditorFrontmatter } from '@/components/markdown-editor'
import { Button } from '@/components/ui/button'
import { saveBlogPost } from './actions'

interface AdminBlogEditorProps {
  initialSlug: string | null
  initialContent: string
  initialFrontmatter: MarkdownEditorFrontmatter
}

export function AdminBlogEditor({
  initialSlug,
  initialContent,
  initialFrontmatter,
}: AdminBlogEditorProps) {
  const router = useRouter()
  const [content, setContent] = useState(initialContent)
  const [frontmatter, setFrontmatter] = useState(initialFrontmatter)
  const [savedSlug, setSavedSlug] = useState(initialSlug)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const storageKey = `skillet:blog-editor:${savedSlug ?? 'new'}`

  const handleChange = useCallback(
    (nextContent: string, nextFrontmatter: MarkdownEditorFrontmatter) => {
      setContent(nextContent)
      setFrontmatter(nextFrontmatter)
      setMessage(null)
    },
    [],
  )

  const save = useCallback(async () => {
    const result = await saveBlogPost(savedSlug, content, frontmatter)
    window.localStorage.removeItem(storageKey)
    setSavedSlug(result.slug)
    setMessage('Saved')
    router.refresh()

    if (!savedSlug) {
      router.replace(`/admin/blog/${result.slug}/edit`)
    }
  }, [content, frontmatter, router, savedSlug, storageKey])

  function handleSave() {
    startTransition(async () => {
      try {
        await save()
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Save failed')
      }
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/blog"
            className="text-sm font-medium text-(--ink-2) hover:text-(--accent)"
          >
            Blog admin
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {savedSlug ? 'Edit post' : 'New post'}
          </h1>
          <p className="mt-1 text-sm text-(--ink-2)">
            {savedSlug ? `/${savedSlug}` : 'A slug will be generated from the title on save.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {message && (
            <span className="text-sm text-(--ink-2)" role="status">
              {message}
            </span>
          )}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-(--accent)"
              checked={frontmatter.status === 'published'}
              onChange={(event) =>
                setFrontmatter((current) => ({
                  ...current,
                  status: event.target.checked ? 'published' : 'draft',
                }))
              }
            />
            Published
          </label>
          <Button type="button" variant="primary" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <MarkdownEditor
        value={content}
        frontmatter={frontmatter}
        onChange={handleChange}
        onSave={save}
        storageKey={storageKey}
      />
    </div>
  )
}
