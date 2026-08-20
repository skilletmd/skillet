'use client'

import {
  SkillStudioEditor,
  type SkillPublishTarget,
} from '@/components/skill-studio-editor'

interface SkillCreateWorkspaceProps {
  author: string
  orgMode: boolean
  sessionHandle: string
  /** Self + owned/admin teams the user can publish under. */
  publishTargets?: SkillPublishTarget[]
  /** Accepted for route compatibility; no longer used. */
  initialImportOpen?: boolean
}

export function SkillCreateWorkspace({
  author,
  orgMode,
  sessionHandle,
  publishTargets,
}: SkillCreateWorkspaceProps) {
  return (
    <SkillStudioEditor
      mode="create"
      author={author}
      publishTargets={publishTargets}
      orgMode={orgMode}
      sessionHandle={sessionHandle}
    />
  )
}
