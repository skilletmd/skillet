'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CommandBlock } from './command-block'
import { PillToggle } from './ui/pill-toggle'
import { NPX_SKILLET_COMMAND } from '@/config'
import { skillInstallCommand } from '@/lib/cli-install-commands'

// Design spec §2 — the per-runtime install affordance.
//
// Pick a runtime, copy the commands Skillet uses there, and follow the helper
// text. File-based runtimes (Codex, Cursor, …) need `skillet sync` after add.

const RUNTIMES = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Devin Desktop' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'opencode', label: 'OpenCode' },
] as const

type RuntimeId = (typeof RUNTIMES)[number]['id']

/** Runtimes that materialize skills on disk via `skillet sync`. */
const SYNC_RUNTIMES = new Set<RuntimeId>(['codex', 'cursor', 'windsurf', 'hermes', 'opencode'])

// Copy-final helper text per runtime (design spec — do not alter).
const HELPER: Record<RuntimeId, ReactNode> = {
  claude: 'A pack for Claude.ai. Upload it to a project and Claude uses it.',
  codex: (
    <>
      Skillet writes the skill to your Codex project context. Run{' '}
      <code className="font-mono text-sm text-(--ink)">{NPX_SKILLET_COMMAND}</code> first if you
      haven&apos;t.
    </>
  ),
  cursor: 'Skillet writes the skill to your Cursor project rules folder.',
  windsurf: 'Skillet writes the skill to your Devin Desktop skills folder.',
  chatgpt:
    'No automatic upload. ChatGPT has no skills push API. Personal (Plus/Pro): add the SKILL.md to a Custom GPT or Project. Business/Enterprise/Edu: an admin uploads the bundle to ChatGPT Skills (beta).',
  hermes: 'Skillet writes the skill to your Hermes config directory.',
  opencode: (
    <>
      Skillet writes the skill to <code className="font-mono text-sm text-(--ink)">~/.agents/skills</code>,
      which opencode reads. Run{' '}
      <code className="font-mono text-sm text-(--ink)">{NPX_SKILLET_COMMAND}</code> first if you
      haven&apos;t.
    </>
  ),
}

const STORAGE_KEY = 'skillet_preferred_runtime'

function isRuntimeId(value: string | null): value is RuntimeId {
  return value != null && RUNTIMES.some((r) => r.id === value)
}

function runtimeLabel(id: RuntimeId): string {
  return RUNTIMES.find((r) => r.id === id)?.label ?? id
}

export function RuntimeInstallSection({ author, slug }: { author: string; slug: string }) {
  const ref = `@${author}/${slug}`
  const command = skillInstallCommand(ref)
  const [runtime, setRuntime] = useState<RuntimeId>('claude')

  // Land repeat visitors on their preferred runtime (session-scoped).
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY)
      if (isRuntimeId(saved)) setRuntime(saved)
    } catch {
      /* sessionStorage unavailable — keep the default */
    }
  }, [])

  function chooseRuntime(id: RuntimeId) {
    setRuntime(id)
    try {
      window.sessionStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* ignore persistence failures */
    }
  }

  const needsSync = SYNC_RUNTIMES.has(runtime)

  return (
    <div className="flex flex-col gap-5">
      <PillToggle
        semantics="tab"
        mono
        ariaLabel="Choose your runtime"
        options={RUNTIMES.map((r) => ({
          value: r.id,
          label: r.label,
          controls: 'runtime-install-panel',
        }))}
        value={runtime}
        onChange={chooseRuntime}
      />

      <div id="runtime-install-panel" role="tabpanel" className="flex flex-col gap-4">
        <p className="max-w-[68ch] text-sm leading-[1.6] text-(--ink-2)">{HELPER[runtime]}</p>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
              Step 1 · Add to your kit
            </p>
            <CommandBlock command={command} accent={ref} />
          </div>

          {needsSync && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                Step 2 · Sync to {runtimeLabel(runtime)}
              </p>
              <CommandBlock command="skillet sync" />
            </div>
          )}
        </div>

        <p className="font-mono text-xs leading-[1.5] text-(--ink-2)">
          {needsSync
            ? 'Run both commands to install and materialize this skill on your machine.'
            : 'Install with the command above to get the author&apos;s updates as diffs you approve.'}
        </p>
      </div>
    </div>
  )
}
