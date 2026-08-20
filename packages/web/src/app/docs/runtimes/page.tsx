import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/ui/panel'
import {
  PERSISTENCE_COPY,
  PERSISTENCE_ORDER,
  SURFACES,
  countByStatus,
  deliveryBadges,
  surfacesByPersistence,
  type Surface,
  type SurfaceStatus,
} from '@/lib/surfaces'

export const metadata: Metadata = {
  title: 'Runtimes · Skillet docs',
  description:
    'Every surface Skillet delivers skills to, the install mechanism per surface, and what each one promises: always synced, loaded on demand, or sandboxed.',
}

const STATUS_LABEL: Record<SurfaceStatus, string> = {
  operational: 'Operational',
  in_progress: 'In progress',
}

const STATUS_CLASS: Record<SurfaceStatus, string> = {
  operational: 'status-pill-operational',
  in_progress: 'status-pill-progress',
}

function SurfaceRow({ surface }: { surface: Surface }) {
  return (
    <li className="status-runtime-row">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold text-(--ink)">{surface.name}</p>
          {deliveryBadges(surface).map((label) => (
            <Badge key={label} variant="default">
              {label}
            </Badge>
          ))}
          {surface.tiered && <Badge variant="default">tiered</Badge>}
        </div>
        <p className="mt-1 break-words font-mono text-xs leading-relaxed text-(--ink-2)">
          {surface.notes}
        </p>
      </div>
      <span className={`status-pill ${STATUS_CLASS[surface.status]}`}>
        {STATUS_LABEL[surface.status]}
      </span>
    </li>
  )
}

export default function RuntimesDoc() {
  const operational = countByStatus('operational')
  const inProgress = countByStatus('in_progress')

  return (
    <main className="py-10 sm:py-12">
      <p className="font-mono text-sm uppercase tracking-[0.06em] text-(--accent)">runtimes</p>
      <h1 className="mt-2 text-title font-semibold leading-[1.1]">
        Where skills go
      </h1>
      <p className="mt-4 max-w-[60ch] text-base leading-[1.6] text-(--ink-2)">
        Skillet reaches each surface through a different mechanism, and not every surface can keep a
        skill current. Rows are grouped by what actually persists, so the expectation matches
        reality. {operational} live{inProgress > 0 ? `, ${inProgress} in progress` : ''}.
      </p>

      {PERSISTENCE_ORDER.map((persistence) => {
        const surfaces = surfacesByPersistence(persistence)
        if (surfaces.length === 0) return null
        const copy = PERSISTENCE_COPY[persistence]
        return (
          <Panel as="section" key={persistence} className="mt-8">
            <div className="border-b border-(--line) pb-4">
              <h2 className="font-mono text-sm uppercase tracking-[0.06em] text-(--accent)">
                {copy.label}
              </h2>
              <p className="mt-1 text-sm text-(--ink-2)">{copy.expectation}</p>
            </div>
            <ul className="divide-y divide-(--line)">
              {surfaces.map((surface) => (
                <SurfaceRow key={surface.name} surface={surface} />
              ))}
            </ul>
          </Panel>
        )
      })}

      <p className="mt-8 text-sm text-(--ink-2)">
        Per-runtime setup lives in the pages listed under Runtimes in the sidebar.
      </p>
    </main>
  )
}
