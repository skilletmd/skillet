'use client'

import { useCallback, useState } from 'react'
import { Eyebrow } from '@/components/ui/eyebrow'
import {
  fetchSkillBundleFileClient,
  fetchSkillBundleFileIndexClient,
} from '@/lib/skill-bundle-file-fetch'
import { buildVersionDiff, type FileDiff, type FileStatus } from '@/lib/version-diff'
import type { DiffRow } from '@/lib/text-diff'
import type { SkillVersion } from '@/lib/types'

/**
 * Version history with expand-to-diff. Each row is a disclosure button; on first
 * expand we lazily fetch the file index at this version's hash AND the previous
 * one, then diff every changed file (via the same BFF file route the file viewer
 * uses), in the browser. Nothing crosses the RSC wire eagerly — a skill with
 * twenty versions ships zero diff bytes until a row is opened.
 *
 * A skill is a folder, so the diff spans the whole bundle: SKILL.md leads, then
 * any other added / removed / modified file. Binary changes are reported by
 * presence/size (we never pull binary bytes into the browser to detect a change).
 */

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; files: FileDiff[] }
  | { status: 'initial' }
  | { status: 'error' }

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function VersionHistory({
  versions,
  author,
  slug,
  upstreamHeld = false,
  sourceUrl,
}: {
  versions: SkillVersion[]
  author: string
  slug: string
  /** A newer upstream version was held by the scanner; note it here, quietly,
   *  since this is where "why am I not on the latest" is answered. */
  upstreamHeld?: boolean
  /** The mirror's source repo, linked from the held-version note. */
  sourceUrl?: string | null
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [states, setStates] = useState<Record<number, LoadState>>({})

  const load = useCallback(
    async (index: number) => {
      const cur = versions[index]
      const prev = versions[index + 1] // history is newest-first, so prev is below
      if (!cur?.hash) {
        setStates((s) => ({ ...s, [index]: { status: 'error' } }))
        return
      }
      // Oldest version has nothing to compare against — it's the initial import.
      if (!prev?.hash) {
        setStates((s) => ({ ...s, [index]: { status: 'initial' } }))
        return
      }
      const curHash = cur.hash
      const prevHash = prev.hash

      setStates((s) => ({ ...s, [index]: { status: 'loading' } }))
      const [curIndex, prevIndex] = await Promise.all([
        fetchSkillBundleFileIndexClient(author, slug, curHash),
        fetchSkillBundleFileIndexClient(author, slug, prevHash),
      ])
      if (!curIndex || !prevIndex) {
        setStates((s) => ({ ...s, [index]: { status: 'error' } }))
        return
      }
      const files = await buildVersionDiff(
        curIndex,
        prevIndex,
        (hash, path) => fetchSkillBundleFileClient(author, slug, hash, path).then((f) => f?.text ?? null),
        curHash,
        prevHash,
      )
      setStates((s) => ({ ...s, [index]: { status: 'ready', files } }))
    },
    [author, slug, versions],
  )

  const toggle = useCallback(
    (index: number) => {
      const next = openIndex === index ? null : index
      setOpenIndex(next)
      if (next != null && !states[index]) void load(index)
    },
    [openIndex, states, load],
  )

  const repoLink =
    sourceUrl && /^https?:\/\//i.test(sourceUrl) ? (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-(--accent) underline underline-offset-2 hover:text-(--ink)"
      >
        source repo
      </a>
    ) : (
      'source repo'
    )

  return (
    <section>
      <Eyebrow>Version history</Eyebrow>
      {upstreamHeld && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-(--caution)/40 bg-(--caution)/10 px-3 py-2 text-sm leading-[1.5] text-(--ink-2)">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--caution)"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2.5 1.5 13.5h13L8 2.5Z" />
            <path d="M8 6.5v3" />
            <path d="M8 11.5h.01" />
          </svg>
          <span>
            A newer version in the {repoLink}{' '}
            was held back by our scanner. You&rsquo;re on the last one that passed.
          </span>
        </p>
      )}
      <ul className="mt-3 space-y-1">
        {versions.map((v, i) => {
          const isOpen = openIndex === i
          const state = states[i] ?? { status: 'idle' }
          const canExpand = !!v.hash
          return (
            <li key={`${v.version}-${i}`}>
              <button
                type="button"
                onClick={() => canExpand && toggle(i)}
                aria-expanded={isOpen}
                disabled={!canExpand}
                className="group flex w-full items-start gap-3 rounded-md py-1.5 text-left transition-colors hover:bg-(--card-soft) disabled:cursor-default disabled:hover:bg-transparent"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className={`mt-1 h-3 w-3 shrink-0 text-(--ink-2) transition-transform ${
                    isOpen ? 'rotate-90' : ''
                  } ${canExpand ? '' : 'opacity-0'}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className="min-w-0 flex-1 break-all font-mono text-sm text-(--ink)">
                  {v.version}
                </span>
                <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                  {shortDate(v.publishedAt)}
                </span>
              </button>

              {v.changelog && !isOpen && (
                <p className="mb-1 ml-6 text-sm leading-[1.5] text-(--ink-2)">{v.changelog}</p>
              )}

              {isOpen && (
                <div className="mb-2 ml-6">
                  {v.changelog && (
                    <p className="mb-2 text-sm leading-[1.5] text-(--ink-2)">{v.changelog}</p>
                  )}
                  <DiffBody state={state} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DiffBody({ state }: { state: LoadState }) {
  if (state.status === 'loading') {
    return <p className="py-2 text-sm text-(--ink-2)">Loading changes…</p>
  }
  if (state.status === 'initial') {
    return <p className="py-2 text-sm text-(--ink-2)">Initial version.</p>
  }
  if (state.status === 'error') {
    return <p className="py-2 text-sm text-(--ink-2)">Couldn’t load the diff for this version.</p>
  }
  if (state.status !== 'ready') return null

  if (state.files.length === 0) {
    return <p className="py-2 text-sm text-(--ink-2)">No file changes in this version.</p>
  }

  return (
    <div className="space-y-3">
      {state.files.map((file) => (
        <FileDiffView key={file.path} file={file} />
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<FileStatus, string> = {
  added: 'added',
  removed: 'removed',
  modified: '',
  'binary-added': 'binary added',
  'binary-removed': 'binary removed',
  'binary-changed': 'binary changed',
}

function FileDiffView({ file }: { file: FileDiff }) {
  const label = STATUS_LABEL[file.status]
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
        <span className="text-(--ink) break-all">{file.path}</span>
        {label && <span className="text-(--ink-2)">{label}</span>}
        {(file.added > 0 || file.removed > 0) && (
          <span>
            <span className="text-(--success)">+{file.added}</span>{' '}
            <span className="text-(--danger)">−{file.removed}</span>
          </span>
        )}
      </div>
      {file.rows && file.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-(--line) bg-(--card-soft)">
          <pre className="min-w-full font-mono text-xs leading-[1.55]">
            {file.rows.map((row, i) => (
              <DiffRowLine key={i} row={row} />
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

function DiffRowLine({ row }: { row: DiffRow }) {
  if (row.type === 'gap') {
    return (
      <div className="select-none px-3 py-0.5 text-(--ink-2)">
        {'  '}⋯ {row.hidden} unchanged {row.hidden === 1 ? 'line' : 'lines'}
      </div>
    )
  }
  const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '
  const cls =
    row.type === 'add'
      ? 'bg-(--success-bg) text-(--success)'
      : row.type === 'del'
        ? 'bg-(--danger-bg) text-(--danger)'
        : 'text-(--ink-2)'
  return (
    <div className={`whitespace-pre px-3 py-0.5 ${cls}`}>
      <span className="select-none opacity-60">{sign} </span>
      {row.text || ' '}
    </div>
  )
}
