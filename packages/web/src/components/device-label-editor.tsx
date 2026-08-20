'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Pencil } from '@/components/ui/icons'

interface DeviceLabelEditorProps {
  label: string | null
  fallback: string
  maxLength?: number
  onSave: (label: string) => Promise<string | null>
}

export function DeviceLabelEditor({
  label,
  fallback,
  maxLength = 120,
  onSave,
}: DeviceLabelEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const display = label?.trim() || fallback

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate text-sm font-semibold text-(--ink)">{display}</p>
        <button
          type="button"
          aria-label="Rename device"
          title="Rename"
          className="shrink-0 rounded p-0.5 text-(--ink-3) transition-colors hover:text-(--ink)"
          onClick={() => {
            setDraft(label ?? '')
            setError(null)
            setEditing(true)
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={maxLength}
          placeholder={fallback}
          autoFocus
          className="min-w-[10rem] flex-1 rounded-lg border border-(--line) bg-(--surface) px-2.5 py-1.5 text-sm text-(--ink) outline-none focus:border-(--info)"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false)
              setError(null)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              void (async () => {
                setSaving(true)
                setError(null)
                try {
                  await onSave(draft)
                  setEditing(false)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not save label.')
                } finally {
                  setSaving(false)
                }
              })()
            }
          }}
        />
        <Button
          type="button"
          disabled={saving}
          variant="primary"
          size="sm"
          onClick={() => {
            void (async () => {
              setSaving(true)
              setError(null)
              try {
                await onSave(draft)
                setEditing(false)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save label.')
              } finally {
                setSaving(false)
              }
            })()
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs text-(--danger)">{error}</p> : null}
    </div>
  )
}
