import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import manifest from '@/lib/scan-detector-inventory.json'
import type { DetectorManifest, LintFinding, LintSeverity } from '@/lib/scan-taxonomy-lint'
import {
  buildScannerAudit,
  labScannerBlocked,
  realVocabulary,
} from './scanner-audit'

export const metadata: Metadata = {
  title: 'Scanner vocabulary — Lab',
  robots: { index: false, follow: false },
}

const SEV_COLOR: Record<LintSeverity, string> = {
  error: 'var(--danger)',
  warn: 'var(--warning)',
  info: 'var(--ink-2)',
}

const MONO = 'var(--font-mono, monospace)'

const TABLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  lineHeight: 1.45,
}
const TH: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
  padding: '0 12px 8px',
  borderBottom: '1px solid var(--line)',
  verticalAlign: 'bottom',
}
const TD: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'top',
  color: 'var(--ink)',
  borderTop: '1px solid var(--line)',
}
const TD_MUTED: React.CSSProperties = { ...TD, color: 'var(--ink-2)' }

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'muted' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        whiteSpace: 'nowrap',
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 999,
        color: tone === 'warn' ? 'var(--warning)' : 'var(--ink-2)',
        border: `1px solid ${tone === 'warn' ? 'var(--warning)' : 'var(--line)'}`,
      }}
    >
      {children}
    </span>
  )
}

/** Lint findings for one row, rendered as a sub-row spanning the whole table so
 *  the issue + suggestion stay attached to the entry without breaking column scan. */
function FindingsRow({ findings, span }: { findings: LintFinding[]; span: number }) {
  if (findings.length === 0) return null
  return (
    <tr>
      <td colSpan={span} style={{ padding: '0 12px 12px 12px', verticalAlign: 'top' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {findings.map((f, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.4 }}>
              <span
                style={{
                  marginTop: 5,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: SEV_COLOR[f.severity],
                  flexShrink: 0,
                }}
              />
              <span>
                <span style={{ color: 'var(--ink)' }}>{f.issue}</span>{' '}
                <span style={{ color: 'var(--ink-2)' }}>→ {f.suggestion}</span>
              </span>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  )
}

/** Detector ids as small wrapping chips — whole tokens never break mid-word, so
 *  the column stays compact and scannable instead of a tall stack of fragments. */
function DetectorChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span style={{ color: 'var(--ink-2)' }}>—</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {ids.map((id) => (
        <span
          key={id}
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: 1.5,
            padding: '1px 6px',
            borderRadius: 6,
            color: 'var(--ink-2)',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
          }}
        >
          {id}
        </span>
      ))}
    </div>
  )
}

function SummaryChip({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />
      <strong style={{ color: 'var(--ink)' }}>{n}</strong> {label}
    </span>
  )
}

/** A type chip for the lane column. */
function KindTag({ kind }: { kind: 'permission' | 'flag' }) {
  return <Tag tone={kind === 'flag' ? 'warn' : 'muted'}>{kind}</Tag>
}

export default function ScannerVocabularyLab() {
  // Dev-only: the scanner's detector inventory + coverage gaps aren't a public
  // surface. notFound() in production; renders for local/dev.
  if (labScannerBlocked(process.env.NODE_ENV)) notFound()

  const audit = buildScannerAudit(realVocabulary(), manifest as DetectorManifest)
  const permCount = audit.permissions.length
  const flagCount = audit.flags.length

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 20px 80px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>Scanner vocabulary</h1>
      <p style={{ marginTop: 8, color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.5, maxWidth: 680 }}>
        The one scanner vocabulary the scanner shows installers — permissions (what a skill can
        do) and flags (threat patterns) — audited for consistency and cross-referenced against the
        detectors that emit each id. Read-only; lints are deterministic.
      </p>
      <div style={{ marginTop: 16, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <SummaryChip n={audit.summary.error} label="errors" color="var(--danger)" />
        <SummaryChip n={audit.summary.warn} label="warnings" color="var(--warning)" />
        <SummaryChip n={audit.summary.info} label="notes" color="var(--ink-2)" />
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {permCount} permissions · {flagCount} flags
        </span>
      </div>

      <div style={{ marginTop: 24, overflowX: 'auto' }}>
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={{ ...TH, width: '9%' }}>Type</th>
              <th style={{ ...TH, width: '20%' }}>Shown as</th>
              <th style={{ ...TH, width: '26%' }}>Describe</th>
              <th style={{ ...TH, width: '20%' }}>Fix</th>
              <th style={{ ...TH, width: '25%' }}>Detectors</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((row) => (
              <VocabRowEl key={`${row.kind}:${row.id}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

/** One vocabulary row — permission or flag — in the single table. Flag-only
 *  columns (Fix, Detectors) show "—" on permission rows. */
function VocabRowEl({ row }: { row: ReturnType<typeof buildScannerAudit>['rows'][number] }) {
  return (
    <>
      <tr>
        <td style={TD}>
          <KindTag kind={row.kind} />
        </td>
        <td style={TD}>
          {/* Label on top (what installers see), raw key beneath — merged to save a column. */}
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{row.label}</div>
          <div style={{ marginTop: 2, fontFamily: MONO, fontSize: 12, color: 'var(--ink-2)' }}>{row.id}</div>
          {(!row.emitted || row.partial) && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {!row.emitted && <Tag tone="warn">no detector</Tag>}
              {row.partial && <Tag>dynamic why</Tag>}
            </div>
          )}
        </td>
        <td style={TD_MUTED}>{row.describe || <em>no describe</em>}</td>
        <td style={TD_MUTED}>{row.fix ?? '—'}</td>
        <td style={TD}>
          {row.kind === 'flag' ? (
            <DetectorChips ids={row.detectors} />
          ) : (
            // Permissions ARE detected — by the capability detector family — but
            // the inventory doesn't enumerate those pieces per permission yet, so
            // we say so rather than showing a bare "—" (which on a flag means a gap).
            <span style={{ color: 'var(--ink-2)', fontStyle: 'italic' }}>capability scan</span>
          )}
        </td>
      </tr>
      <FindingsRow findings={row.findings} span={5} />
    </>
  )
}
