// Homepage hero diagram: one SKILL.md in the center, syncing out to your AI
// agents (left) and your coworkers (right). Lines are SVG paths; nodes are HTML
// overlaid by percentage so text stays crisp at any scale. Server component —
// no client JS.

import { ClaudeLogo, OpenAiLogo, OpenClawLogo } from '@/components/brand-logos'

type Node = {
  label: string
  meta: string
  icon: React.ReactNode
  iconFrame?: 'default' | 'plain'
}

type CoworkerAvatar = 'maya' | 'diego' | 'priya'

function Avatar({ person }: { person: CoworkerAvatar }) {
  return (
    <svg className="sync-face-avatar" viewBox="0 0 64 64" aria-hidden="true">
      {person === 'maya' ? (
        <>
          <path d="M19 33c0-10.2 5.2-17.2 13.2-17.2 8.7 0 13.8 7 13.8 17.2" />
          <path d="M20.5 29.2c5.6-7.5 14.4-9.5 25-3.2" />
        </>
      ) : null}
      {person === 'diego' ? (
        <>
          <path d="M18.8 31.5c1-9.5 6.4-15 13.4-15 7.3 0 12.4 5.2 13 14.8" />
          <path d="M21.8 27.5c5.6-3.8 12.9-4.2 21-.7" />
          <path d="M26.5 40.4h11" />
        </>
      ) : null}
      {person === 'priya' ? (
        <>
          <path d="M17.5 34c.8-10.9 6.5-18.3 15.4-18.3 8.4 0 13.4 7.2 13.8 18" />
          <path d="M20.2 30.4c4-7.2 15.9-9.8 25.8-1" />
          <path d="M45.8 35.2c1.6 1.3 1.9 3.1.7 4.6" />
        </>
      ) : null}
      <path d="M21 34.5c0 9 4.4 15.2 11 15.2s11-6.2 11-15.2" />
      <path d="M27 34h.1M37 34h.1" />
      <path d="M32 36.2v4.2" />
      <path d="M28.4 44c2.3 1.7 4.9 1.7 7.2 0" />
      <path d="M18 56c3.4-5.2 8-7.8 14-7.8s10.6 2.6 14 7.8" />
    </svg>
  )
}

function ImageAvatar({
  src,
  alt,
  crop = 'tight',
}: {
  src: string
  alt: string
  crop?: 'tight' | 'none'
}) {
  return (
    <img
      className={`sync-image-avatar${crop === 'none' ? ' is-no-crop' : ''}`}
      src={src}
      alt={alt}
    />
  )
}

const AGENTS: Node[] = [
  { label: 'Claude', meta: 'v1.8.2', icon: <ClaudeLogo /> },
  { label: 'ChatGPT', meta: 'v1.8.2', icon: <OpenAiLogo /> },
  { label: 'OpenClaw', meta: 'v1.8.2', icon: <OpenClawLogo /> },
]

const COWORKERS: Node[] = [
  {
    label: 'Maya',
    meta: 'Support',
    icon: <ImageAvatar src="/avatars/woman-1.svg" alt="Maya" crop="none" />,
    iconFrame: 'plain',
  },
  {
    label: 'Diego',
    meta: 'Sales',
    icon: <ImageAvatar src="/avatars/man-1.svg" alt="Diego" crop="none" />,
    iconFrame: 'plain',
  },
  {
    label: 'Priya',
    meta: 'Engineering',
    icon: <ImageAvatar src="/avatars/woman-2.svg" alt="Priya" crop="none" />,
    iconFrame: 'plain',
  },
]

// Center y for each of the three rows, in the 880x660 viewBox.
const ROWS = [96, 300, 504]

// Connector paths: doc edge -> node edge, one per row. Left side, then mirrored.
const LEFT_PATHS = [
  'M300,150 C238,150 186,96 92,96',
  'M300,286 C232,286 178,300 92,300',
  'M300,422 C238,422 186,504 92,504',
]
const RIGHT_PATHS = [
  'M580,150 C642,150 694,96 788,96',
  'M580,286 C648,286 702,300 788,300',
  'M580,422 C642,422 694,504 788,504',
]

function DocLine({ width, dim }: { width: number; dim?: boolean }) {
  return <span className={`sync-doc-line${dim ? ' is-dim' : ''}`} style={{ width: `${width}%` }} />
}

export function SyncDiagram() {
  return (
    <figure
      className="sync-diagram"
      aria-label="One SKILL.md syncing to your agents and your coworkers"
    >
      <span className="sync-col-head sync-col-head-left">Your agents</span>
      <span className="sync-col-head sync-col-head-right">Your coworkers</span>

      <svg
        className="sync-wires"
        viewBox="0 0 880 660"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {[...LEFT_PATHS, ...RIGHT_PATHS].map((d, i) => (
          <g key={d}>
            <path d={d} className="sync-wire-base" fill="none" />
            <path
              d={d}
              className="sync-wire-flow"
              fill="none"
              style={{ animationDelay: `${i * 320}ms` }}
            />
            <path
              d={d}
              className="sync-wire-pulse"
              fill="none"
              style={{ animationDelay: `${i * 420}ms` }}
            />
          </g>
        ))}
      </svg>

      {/* Center document */}
      <div className="sync-doc">
        <span className="sync-doc-fold" />
        <header className="sync-doc-head">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="sync-doc-glyph">
            <path
              d="M6 2.5h7L19 8v13.5H6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M13 2.5V8h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sync-doc-name">SKILL.md</span>
        </header>
        <span className="sync-doc-version">v1.8.2</span>

        <div className="sync-doc-body">
          <p className="sync-doc-h1"># Sales Email</p>
          <p className="sync-doc-h2">## Goal</p>
          <DocLine width={62} />
          <DocLine width={48} dim />
          <p className="sync-doc-h2">## Principles</p>
          <DocLine width={70} />
          <DocLine width={55} dim />
          <DocLine width={40} dim />
          <p className="sync-doc-h2">## Framework</p>
          <DocLine width={58} />
          <DocLine width={64} dim />
        </div>
      </div>

      {/* Agents (left) + coworkers (right), overlaid by percentage */}
      {AGENTS.map((node, i) => (
        <NodeChip key={node.label} node={node} side="left" row={i} kind="agent" />
      ))}
      {COWORKERS.map((node, i) => (
        <NodeChip key={node.label} node={node} side="right" row={i} kind="coworker" />
      ))}
    </figure>
  )
}

function NodeChip({
  node,
  side,
  row,
  kind,
}: {
  node: Node
  side: 'left' | 'right'
  row: number
  kind: 'agent' | 'coworker'
}) {
  const x = side === 'left' ? 92 : 788
  const y = ROWS[row]
  return (
    <div
      className={`sync-node sync-node-${kind}`}
      style={{ left: `${(x / 880) * 100}%`, top: `${(y / 660) * 100}%` }}
    >
      <span className={`sync-node-icon${node.iconFrame === 'plain' ? ' is-plain-avatar' : ''}`}>
        {node.icon}
      </span>
      <span className="sync-node-label">{node.label}</span>
      <span className="sync-node-meta">{node.meta}</span>
    </div>
  )
}
