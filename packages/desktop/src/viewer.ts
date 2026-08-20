// The ?view=viewer window (customize-in-place, U6): a real, resizable window —
// not the tray — that shows YOUR edited version of a skill (rendered / raw) and
// the yours-vs-theirs diff. It's the only surface where the local edit is
// visible; the web /updates only ever shows the author's side (KD1, KD5).
//
// Opened by U7's "See changes" with `?view=viewer&skill=@author/slug`. The bytes
// come from the CLI: the edited markdown from `kit_status`, the diff from
// `edit_diff`. All render logic is pure in viewer-render.ts — this file is only
// DOM wiring.

import { invoke } from '@tauri-apps/api/core'
import { escapeHtml } from './escape-html'
import {
  buildFileTree,
  diffToHtml,
  fileIsMarkdown,
  frontmatterCardHtml,
  humanSize,
  parseEditDiff,
  parseFrontmatter,
  renderMarkdownToSafeHtml,
  type EditDiffJson,
  type FileTreeNode,
  type SkillFileContent,
  type SkillFileEntry,
} from './viewer-render'
import type { KitStatus, Skill } from './tray-logic'

const params = new URLSearchParams(location.search)

// Inlined so the viewer bundle stays standalone (no cross-entry import of the
// tray's icon map). EXTERNAL_ICON matches ICON.external in main.ts.
const EXTERNAL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h9v9"/><path d="M17 7L7 17"/></svg>`
const FOLDER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`
const CHEVRON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`
const CODE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l-5 6 5 6"/><path d="M16 6l5 6-5 6"/></svg>`
const SIDEBAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>`

function inBrowserPreview(): boolean {
  return !('__TAURI_INTERNALS__' in window)
}

/** `@alice/foo` → `foo` — the bare slug used to match a ref to a materialized skill. */
function bareSlug(ref: string): string {
  return (ref.split('/').pop() ?? ref).replace(/^@/, '')
}

/**
 * Parse a viewer `?skill=` ref into owner + slug. Two authors can ship the same
 * bare slug (`@alice/foo` and `@bob/foo` both installed) — matching on slug
 * alone can resolve the WRONG skill's body while diff/propose still act on the
 * requested ref. A bare/unowned ref (no leading `@owner/`) has no owner to
 * check, so it falls back to a slug-only match.
 */
export function parseSkillRef(ref: string): { owner: string | null; slug: string } {
  const m = ref.match(/^@([^/]+)\/(.+)$/)
  return m ? { owner: m[1]!, slug: m[2]! } : { owner: null, slug: ref.replace(/^@/, '') }
}

/**
 * Resolve a viewer `?skill=` ref to its materialized skill in `kit_status`.
 * Owned refs (`@owner/slug`) must match BOTH owner and slug — two authors can
 * ship the same bare slug, and matching on slug alone can render the WRONG
 * author's body while diff/propose still act on the requested ref. A
 * bare/unowned ref has no owner to disambiguate against, so it falls back to
 * a slug-only match.
 */
export function resolveSkillForRef(kit: KitStatus, ref: string): Skill | null {
  const { owner, slug } = parseSkillRef(ref)
  return (
    kit.skills.find((s) => bareSlug(s.slug) === slug && (owner === null || s.owner === owner)) ??
    null
  )
}

// A tiny sample so `?view=viewer` renders in a plain browser (the dev preview
// switcher) without a live CLI. Never shown inside the packaged app.
const SAMPLE_SKILL: Skill = {
  slug: 'refund-policy',
  name: 'Refund policy',
  description: 'Your edited copy',
  owner: 'acme',
  source: 'kit',
  pinned: false,
  body: '# Refund policy\n\nApprove refunds under **$100** automatically (you raised the cap).\n\nAbove that, ask for the order ID and reason, then summarize for a human.\n\n[Docs](https://example.com/refunds)\n',
}
const SAMPLE_DIFF: EditDiffJson = {
  ok: true,
  skill: '@acme/refund-policy',
  customized: true,
  hasUpdate: true,
  files: [{ path: 'SKILL.md', status: 'changed' }],
}

async function loadSkill(ref: string): Promise<Skill | null> {
  if (inBrowserPreview()) return SAMPLE_SKILL
  try {
    const kit = JSON.parse(await invoke<string>('kit_status')) as KitStatus
    return resolveSkillForRef(kit, ref)
  } catch {
    return null
  }
}

async function loadDiff(ref: string): Promise<EditDiffJson> {
  if (inBrowserPreview()) return SAMPLE_DIFF
  try {
    return parseEditDiff(await invoke<string>('edit_diff', { skill: ref }))
  } catch (e) {
    return { ok: false, error: String(e), files: [] }
  }
}

// Preview sample: a couple of extra files so the sidebar shows without a CLI.
const SAMPLE_FILES: SkillFileEntry[] = [
  { rel: 'SKILL.md', size: 320, binary: false },
  { rel: 'resources/deploy.sh', size: 210, binary: false },
  { rel: 'Archive.zip', size: 48000, binary: true },
]

/** The skill's bundle manifest (all files), for the sidebar. `path` is SKILL.md. */
async function loadFiles(path: string | null | undefined): Promise<SkillFileEntry[]> {
  if (inBrowserPreview()) return SAMPLE_FILES
  if (!path) return []
  try {
    const parsed = JSON.parse(await invoke<string>('skill_files', { skillMdPath: path })) as {
      files?: SkillFileEntry[]
    }
    return parsed.files ?? []
  } catch {
    return []
  }
}

/** One bundle file's contents, lazy-loaded when its sidebar row is clicked. */
async function loadFileContent(path: string, rel: string): Promise<SkillFileContent> {
  if (inBrowserPreview()) {
    return { rel, binary: false, tooBig: false, size: 0, content: `# ${rel}\n\n(preview)\n` }
  }
  const parsed = JSON.parse(
    await invoke<string>('skill_file', { skillMdPath: path, rel }),
  ) as SkillFileContent
  return parsed
}

export async function renderViewer(): Promise<void> {
  const app = document.getElementById('app')!
  // In the dev preview (plain browser) default to the sample so the window has
  // something to show; the packaged app always arrives with ?skill=.
  const ref = params.get('skill') ?? (inBrowserPreview() ? '@acme/refund-policy' : '')

  if (!ref) {
    app.innerHTML = `<div class="viewer"><div class="vw-empty">No skill selected.</div></div>`
    return
  }

  const [skill, diff] = await Promise.all([loadSkill(ref), loadDiff(ref)])
  // The bundle manifest drives the sidebar. Depends on the resolved skill's path,
  // so it can't join the parallel load above.
  const files = skill ? await loadFiles(skill.path) : []
  const multi = files.length > 1
  const title = skill?.name || bareSlug(ref)
  const author = skill?.owner ? `@${escapeHtml(skill.owner)}` : ''
  // The same window backs two entry points: "See changes" on an edited skill
  // (badge + Propose + the yours-vs-theirs diff) and "view locally" on any plain
  // skill (just the rendered/raw body). `customized` is the CLI's own signal —
  // false/absent for a skill you haven't edited — so the edit-only chrome drops.
  const isEdited = diff.customized === true

  const tree = buildFileTree(files)
  // Folders start collapsed — a 100-file skill (lib/*, scripts/*) should open to
  // a short list, not a wall. The user expands what they want to read.
  const expandedDirs = new Set<string>()
  let selected = 'SKILL.md'
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
  const sidebarShell = multi
    ? `<nav class="vw-sidebar" id="vw-sidebar" aria-label="Bundle files"></nav><div class="vw-resizer" id="vw-resizer" role="separator" aria-orientation="vertical"></div>`
    : ''
  // Restore the collapsed-sidebar preference (per window, like the width).
  const collapsedStart = multi && localStorage.getItem('viewerSidebarCollapsed') === '1'

  app.innerHTML = `
    <div class="viewer${collapsedStart ? ' sidebar-collapsed' : ''}">
      <header class="vw-head">
        <div class="vw-title">
          ${multi ? `<button type="button" class="vw-icon" id="vw-sidebar-toggle" title="Toggle files" aria-label="Toggle files">${SIDEBAR_ICON}</button>` : ''}
          <span class="vw-name">${escapeHtml(title)}</span>
          ${author ? `<span class="vw-author">${author}</span>` : ''}
        </div>
        <div class="vw-actions">
          ${skill?.path ? `<button type="button" class="vw-link" id="vw-folder" title="Your editable copy. Edit the files here, then Sync"><span class="ico vw-link-ico">${FOLDER_ICON}</span>Folder</button>` : ''}
          ${skill?.owner ? `<button type="button" class="vw-link" id="vw-web"><span class="ico vw-link-ico">${EXTERNAL_ICON}</span>Web</button>` : ''}
          <button type="button" class="vw-icon vw-code" id="vw-code" title="View source" aria-label="View source" aria-pressed="false">${CODE_ICON}</button>
        </div>
      </header>
      <div class="vw-main">
        ${sidebarShell}
        <div class="vw-scroll">
          ${
            // Pinned at the TOP, open by default: the diff is why you opened an
            // edited skill, so it must be the first thing you see — not buried
            // under the whole rendered doc. Collapsible so a reader can dismiss it.
            isEdited
              ? `<details class="vw-diff-wrap" open>
            <summary class="vw-diff-title"><span class="vw-diff-chevron">${CHEVRON_ICON}</span>Your changes</summary>
            <p class="vw-diff-sub">These edits are only on this device. The original is unchanged.</p>
            <div id="vw-diff"></div>
          </details>`
              : ''
          }
          <section class="vw-body">
            <div class="vw-doc markdown" id="vw-rendered"></div>
            <pre class="vw-raw" id="vw-raw" hidden></pre>
          </section>
        </div>
      </div>
      ${
        files.length
          ? `<footer class="vw-foot"><span>${files.length} file${files.length === 1 ? '' : 's'} · ${escapeHtml(humanSize(totalSize))}</span><span id="vw-foot-size"></span></footer>`
          : ''
      }
    </div>`

  const rendered = document.getElementById('vw-rendered')!
  const raw = document.getElementById('vw-raw') as HTMLPreElement
  const diffEl = document.getElementById('vw-diff') // absent in plain (non-edited) view

  let mode: 'rendered' | 'raw' = 'rendered'
  const applyMode = (): void => {
    rendered.hidden = mode === 'raw'
    raw.hidden = mode !== 'raw'
  }

  const sidebarEl = document.getElementById('vw-sidebar')

  // One sidebar row: a collapsible folder (chevron) or a file leaf. Indent grows
  // with depth; binary files show their size.
  const nodeHtml = (node: FileTreeNode, depth: number): string => {
    const pad = 8 + depth * 12
    if (node.kind === 'dir') {
      const open = expandedDirs.has(node.path)
      return (
        `<button type="button" class="vw-tree-dir" data-dir="${escapeHtml(node.path)}" style="padding-left:${pad}px">` +
        `<span class="vw-tree-chev${open ? ' open' : ''}">${CHEVRON_ICON}</span>` +
        `<span class="vw-file-name">${escapeHtml(node.name)}</span>` +
        `</button>` +
        (open ? node.children.map((c) => nodeHtml(c, depth + 1)).join('') : '')
      )
    }
    return (
      `<button type="button" class="vw-file${node.rel === selected ? ' on' : ''}" data-file="${escapeHtml(node.rel)}" style="padding-left:${pad + 16}px">` +
      `<span class="vw-file-name">${escapeHtml(node.name)}</span>` +
      `${node.binary ? `<span class="vw-file-size">${escapeHtml(humanSize(node.size))}</span>` : ''}` +
      `</button>`
    )
  }

  const renderSidebar = (): void => {
    if (!sidebarEl) return
    sidebarEl.innerHTML = tree.map((n) => nodeHtml(n, 0)).join('')
    for (const btn of sidebarEl.querySelectorAll<HTMLButtonElement>('.vw-tree-dir')) {
      btn.onclick = () => {
        const path = btn.dataset.dir ?? ''
        if (expandedDirs.has(path)) expandedDirs.delete(path)
        else expandedDirs.add(path)
        renderSidebar()
      }
    }
    for (const btn of sidebarEl.querySelectorAll<HTMLButtonElement>('.vw-file')) {
      btn.onclick = () => void showFile(btn.dataset.file ?? 'SKILL.md')
    }
  }

  const markActive = (): void => {
    for (const b of app.querySelectorAll<HTMLButtonElement>('.vw-file'))
      b.classList.toggle('on', b.dataset.file === selected)
  }

  // Render the selected bundle file. SKILL.md is already in hand (skill.body);
  // other files load lazily via the confined skill_file IPC. Markdown renders;
  // other text shows as source; binary/oversized files show a note only.
  const showFile = async (rel: string): Promise<void> => {
    selected = rel
    markActive()

    if (rel === 'SKILL.md' && !skill) {
      rendered.innerHTML = `<div class="vw-empty">This skill isn't materialized on this device.</div>`
      raw.textContent = ''
      return
    }

    let content = ''
    let binary = false
    let tooBig = false
    let size = 0
    if (rel === 'SKILL.md' && skill) {
      content = skill.body
    } else if (skill?.path) {
      rendered.innerHTML = `<div class="vw-empty">Loading…</div>`
      try {
        const r = await loadFileContent(skill.path, rel)
        content = r.content
        binary = r.binary
        tooBig = r.tooBig
        size = r.size
      } catch {
        rendered.innerHTML = `<div class="vw-empty">Couldn't read this file.</div>`
        raw.textContent = ''
        return
      }
    }

    if (binary || tooBig) {
      const label = binary ? 'Binary file' : 'File too large to preview'
      const suffix = size ? ` · ${escapeHtml(humanSize(size))}` : ''
      rendered.innerHTML = `<div class="vw-empty">${label}${suffix}. Open the folder to view it.</div>`
      raw.textContent = ''
    } else if (fileIsMarkdown(rel)) {
      // Frontmatter renders as a header card (description + fields), matching the
      // web; the rest of the markdown follows. Raw still shows the file verbatim.
      const fm = parseFrontmatter(content)
      rendered.innerHTML = frontmatterCardHtml(fm) + renderMarkdownToSafeHtml(fm.body)
      raw.textContent = content
    } else {
      // Non-markdown text: show the source in both panes (Rendered just frames it).
      const pre = document.createElement('pre')
      pre.className = 'vw-raw'
      pre.textContent = content
      rendered.replaceChildren(pre)
      raw.textContent = content
    }
    // Footer shows the selected file's size (from the manifest, since SKILL.md's
    // body carries no size of its own).
    const footSize = document.getElementById('vw-foot-size')
    if (footSize) {
      const entrySize = files.find((f) => f.rel === rel)?.size ?? size
      footSize.textContent = entrySize ? humanSize(entrySize) : ''
    }
    applyMode()
  }

  renderSidebar()
  void showFile('SKILL.md')

  if (diffEl) diffEl.innerHTML = diffToHtml(diff.files ?? [])

  // Draggable divider: widen/narrow the file sidebar. Width persists per window.
  const resizer = document.getElementById('vw-resizer')
  if (resizer && sidebarEl) {
    const KEY = 'viewerSidebarWidth'
    const clamp = (w: number): number => Math.max(150, Math.min(520, w))
    const saved = Number(localStorage.getItem(KEY))
    if (saved) sidebarEl.style.width = `${clamp(saved)}px`
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault()
      resizer.classList.add('dragging')
      const startX = e.clientX
      const startW = sidebarEl.getBoundingClientRect().width
      const onMove = (ev: MouseEvent): void => {
        sidebarEl.style.width = `${clamp(startW + (ev.clientX - startX))}px`
      }
      const onUp = (): void => {
        resizer.classList.remove('dragging')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        try {
          localStorage.setItem(KEY, String(Math.round(sidebarEl.getBoundingClientRect().width)))
        } catch {
          /* private mode — width just won't persist */
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  // The </> button toggles rendered ⇄ raw source for the selected file.
  const codeBtn = document.getElementById('vw-code')
  codeBtn?.addEventListener('click', () => {
    mode = mode === 'raw' ? 'rendered' : 'raw'
    codeBtn.classList.toggle('on', mode === 'raw')
    codeBtn.setAttribute('aria-pressed', String(mode === 'raw'))
    applyMode()
  })

  // Collapse/expand the file sidebar (persisted per window, like its width).
  const viewerEl = app.querySelector<HTMLElement>('.viewer')
  document.getElementById('vw-sidebar-toggle')?.addEventListener('click', () => {
    const collapsed = viewerEl?.classList.toggle('sidebar-collapsed') ?? false
    try {
      localStorage.setItem('viewerSidebarCollapsed', collapsed ? '1' : '0')
    } catch {
      /* private mode — preference just won't persist */
    }
  })

  // Reveal the skill's folder in Finder. `skill.path` is the SKILL.md file; the
  // open_folder IPC needs the containing directory (and confines it to an
  // allowed skill root), so strip the trailing filename.
  document.getElementById('vw-folder')?.addEventListener('click', () => {
    const p = skill?.path
    if (!p || inBrowserPreview()) return
    const dir = p.replace(/\/[^/]*$/, '')
    void invoke('open_folder', { path: dir })
  })
  // Open the skill's page on the web (registry). `open_web` prefixes the origin.
  document.getElementById('vw-web')?.addEventListener('click', () => {
    if (!skill?.owner || inBrowserPreview()) return
    void invoke('open_web', { path: `/${skill.owner}/${bareSlug(ref)}` })
  })
}
