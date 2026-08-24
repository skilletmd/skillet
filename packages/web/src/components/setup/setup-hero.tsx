'use client'

import { ClaudeLogo, CursorLogo, OpenAiLogo, HermesLogo, OpenClawLogo } from '@/components/brand-logos'
import { Check, Close } from '@/components/ui/icons'
import { runtimeLabel } from '@/lib/runtime-labels'

export type AgentStatus = 'ready' | 'syncing' | 'live' | 'failed' | 'skipped'

function AgentLogo({ runtime, className }: { runtime: string; className?: string }) {
  switch (runtime) {
    case 'claude-code':
      return <ClaudeLogo className={className} />
    case 'cursor':
      return <CursorLogo className={className} />
    case 'codex':
      return <OpenAiLogo className={className} />
    case 'hermes':
      return <HermesLogo className={className} />
    case 'openclaw':
      return <OpenClawLogo className={className} />
    default:
      return (
        <span className={`grid place-items-center font-semibold ${className ?? ''}`}>
          {runtime.slice(0, 1).toUpperCase()}
        </span>
      )
  }
}

function DeviceGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 19h20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Compact device summary for embedding inside a chat bubble. */
export function DeviceMini({
  label,
  runtimes,
  statusByRuntime,
}: {
  label: string
  runtimes: string[]
  statusByRuntime: Record<string, AgentStatus>
}) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <DeviceGlyph className="h-4 w-4 text-(--ink)" />
        <span className="text-sm font-semibold text-(--ink)">{label}</span>
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-(--success)">
          <span className="h-1.5 w-1.5 rounded-full bg-(--success)" />
          Connected
        </span>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {runtimes.map((r) => {
          const st = statusByRuntime[r] ?? 'ready'
          const ring =
            st === 'live'
              ? 'border-(--success)'
              : st === 'failed'
                ? 'border-(--danger)'
                : st === 'syncing'
                  ? 'border-(--accent)'
                  : 'border-(--line)'
          return (
            <li
              key={r}
              className={`inline-flex items-center gap-1.5 rounded-xl border bg-(--surface) px-2.5 py-1.5 transition-colors duration-300 ${ring} ${st === 'skipped' ? 'opacity-50' : ''}`}
            >
              <AgentLogo runtime={r} className="h-4 w-4 text-(--ink)" />
              <span className="text-sm font-medium text-(--ink)">{runtimeLabel(r)}</span>
              {st === 'live' && (
                <span
                  className="inline-flex h-3 w-3 text-(--success)"
                  style={{ animation: 'ui-pop-in 300ms cubic-bezier(0.34,1.56,0.64,1) both' }}
                  aria-hidden="true"
                >
                  <Check />
                </span>
              )}
              {st === 'failed' && <Close className="h-2.5 w-2.5 text-(--danger)" />}
              {st === 'syncing' && (
                <span className="h-1.5 w-1.5 rounded-full bg-(--accent) motion-safe:animate-pulse" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
