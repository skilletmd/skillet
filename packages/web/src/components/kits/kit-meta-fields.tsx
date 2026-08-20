'use client'

import type { ReactNode } from 'react'
import { FieldLabel, Input, Textarea } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { KitVisibility } from '@/lib/kits'

export type { KitVisibility }

/**
 * The kit identity fields — name, description, visibility — shared by the create
 * and edit flows so both render the same controls (segmented visibility, the one
 * field surface) and can't drift apart. Flow-specific extras (a slug preview,
 * "show on profile", private-confirm) are passed in or rendered by the parent.
 */
export function KitMetaFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  visibility,
  onVisibilityChange,
  slugPreview,
  nameAutoFocus = false,
}: {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  visibility: KitVisibility
  onVisibilityChange: (value: KitVisibility) => void
  /** Optional node under the name field (e.g. the derived @owner/slug). */
  slugPreview?: ReactNode
  nameAutoFocus?: boolean
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <FieldLabel>Kit name</FieldLabel>
        <Input
          autoFocus={nameAutoFocus}
          className="mt-2 w-full"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Frontend essentials"
          required
          minLength={1}
          maxLength={64}
        />
        {slugPreview}
      </label>

      <label className="block">
        <FieldLabel>Kit description</FieldLabel>
        <Textarea
          className="mt-2 min-h-[88px] w-full"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="What this kit is for, and who it's for"
        />
      </label>

      <div>
        <FieldLabel>Visibility</FieldLabel>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
            ]}
            value={visibility}
            onChange={onVisibilityChange}
            ariaLabel="Kit visibility"
          />
          <span className="text-sm text-(--ink-2)">
            {visibility === 'public' ? 'Anyone can find and subscribe' : 'Only you and members'}
          </span>
        </div>
      </div>
    </div>
  )
}
