'use client'

import '@/components/skill-editor.css'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { splitSkillMdFrontmatter } from '@/lib/skill-md-body'
import { skillMarkdownMetadata } from '@/lib/skill-md-metadata'
import { frontmatterRows } from '@/lib/frontmatter-display'
import { useRevealLine } from '@/components/use-reveal-line'

export type SkillEditorMode = 'rich' | 'source'

function createTurndown() {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
  })
  service.use(gfm)
  return service
}

// A trailing empty paragraph so the caret always has a landing spot AFTER the
// last block. Without it a document that ends in a <pre>/<table>/list/heading
// traps the caret inside that terminal block — clicking below lands inside the
// code, with nowhere to type prose or press Enter. Turndown drops this empty
// paragraph, so it is a no-op on the round-tripped markdown (verified for pre,
// list, heading, and paragraph endings).
const TRAILING_PARAGRAPH = '<p><br></p>'

function markdownToEditorHtml(markdown: string): string {
  const html = marked.parse(markdown || '', { async: false }) as string
  // Sanitize with a real allowlist before this is assigned to innerHTML. The
  // previous regex filter missed raw-HTML vectors (e.g. <img onerror=…>, SVG
  // event handlers). DOMPurify strips <script>, all event-handler attributes,
  // javascript:/data: script URLs, and SVG/MathML payloads. The editor only
  // ever produces standard markdown HTML, so the
  // html profile is sufficient and keeps headings/lists/links/code/tables.
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  // Keep a blank body truly empty so `:empty::before` can show the placeholder.
  // A trailing `<p><br></p>` on empty content reads as a stray blank line and
  // blocks the placeholder. We still append it when there is real content so
  // the caret has a landing spot after a terminal block.
  if (!clean.trim()) return ''
  return clean + TRAILING_PARAGRAPH
}

function replaceSkillBody(markdown: string, body: string): string {
  const split = splitSkillMdFrontmatter(markdown)
  const nextBody = body.trim()
  if (!split.frontmatter) return nextBody ? `${nextBody}\n` : ''
  // Match the create-mode scaffold: frontmatter only, no placeholder body text.
  if (!nextBody) return `---\n${split.frontmatter}\n---\n`
  return `---\n${split.frontmatter}\n---\n\n${nextBody}\n`
}

function normalizeFrontmatterValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function replaceFrontmatterField(
  markdown: string,
  field: 'description' | 'name',
  value: string,
): string {
  const split = splitSkillMdFrontmatter(markdown)
  const safeValue = normalizeFrontmatterValue(value)
  const lines = split.frontmatter ? split.frontmatter.split('\n') : []
  const nextLine = `${field}: ${safeValue}`
  const index = lines.findIndex((line) => line.trimStart().startsWith(`${field}:`))

  if (index === -1) {
    lines.unshift(nextLine)
  } else {
    lines[index] = nextLine
  }

  return `---\n${lines.join('\n')}\n---\n\n${split.body}\n`
}

function EditorIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    >
      {children}
    </svg>
  )
}

function IconText({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-4 w-4 items-center justify-center font-mono font-extrabold leading-none ${
        children.length > 1 ? 'text-xs' : 'text-base'
      }`}
    >
      {children}
    </span>
  )
}

const toolbarItems = [
  { icon: <IconText>B</IconText>, title: 'Bold', visualCommand: 'bold' },
  {
    icon: (
      <EditorIcon>
        <path d="M8 4h6" />
        <path d="M6 16h6" />
        <path d="M12 4 8 16" />
      </EditorIcon>
    ),
    title: 'Italic',
    visualCommand: 'italic',
  },
  {
    icon: (
      <EditorIcon>
        <path d="M8.5 6.5 7.2 5.2a3 3 0 0 0-4.2 4.2l2 2a3 3 0 0 0 4.2 0" />
        <path d="m11.5 13.5 1.3 1.3a3 3 0 0 0 4.2-4.2l-2-2a3 3 0 0 0-4.2 0" />
        <path d="m7.8 12.2 4.4-4.4" />
      </EditorIcon>
    ),
    title: 'Link',
    visualCommand: 'createLink',
  },
  {
    icon: <IconText>H1</IconText>,
    title: 'Title',
    visualCommand: 'formatBlock',
    visualValue: 'h1',
  },
  {
    icon: <IconText>H2</IconText>,
    title: 'Heading',
    visualCommand: 'formatBlock',
    visualValue: 'h2',
  },
  {
    icon: (
      <EditorIcon>
        <path d="m7.5 6-4 4 4 4" />
        <path d="m12.5 6 4 4-4 4" />
      </EditorIcon>
    ),
    title: 'Code block',
    visualCommand: 'formatBlock',
    visualValue: 'pre',
  },
  {
    icon: (
      <EditorIcon>
        <path d="M7 6h9" />
        <path d="M7 10h9" />
        <path d="M7 14h9" />
        <path d="M4 6h.01" />
        <path d="M4 10h.01" />
        <path d="M4 14h.01" />
      </EditorIcon>
    ),
    title: 'Bulleted list',
    visualCommand: 'insertUnorderedList',
  },
  {
    icon: (
      <EditorIcon>
        <path d="M8 6H5.5A2.5 2.5 0 0 0 3 8.5V14h5V9H5.5" />
        <path d="M17 6h-2.5A2.5 2.5 0 0 0 12 8.5V14h5V9h-2.5" />
      </EditorIcon>
    ),
    title: 'Quote',
    visualCommand: 'formatBlock',
    visualValue: 'blockquote',
  },
] as const

// Which toolbar items (by title) apply to the current selection, so the bubble
// can light them up and let you toggle them off.
function activeFormats(visual: HTMLElement, selection: Selection): Set<string> {
  const set = new Set<string>()
  try {
    if (document.queryCommandState('bold')) set.add('Bold')
    if (document.queryCommandState('italic')) set.add('Italic')
    if (document.queryCommandState('insertUnorderedList')) set.add('Bulleted list')
  } catch {
    // queryCommandState can throw in some engines; ignore.
  }

  let node: Node | null = selection.anchorNode
  let el: HTMLElement | null =
    node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null)
  let block = ''
  while (el && el !== visual) {
    const tag = el.tagName
    if (tag === 'A') set.add('Link')
    if (!block && ['H1', 'H2', 'H3', 'PRE', 'BLOCKQUOTE', 'P', 'LI'].includes(tag)) block = tag
    el = el.parentElement
  }
  if (block === 'H1') set.add('Title')
  if (block === 'H2') set.add('Heading')
  if (block === 'PRE') set.add('Code block')
  if (block === 'BLOCKQUOTE') set.add('Quote')
  // Headings are bold via CSS, not real bold markup, so queryCommandState reports
  // a false positive. Don't light up B inside a heading.
  if (block === 'H1' || block === 'H2' || block === 'H3') set.delete('Bold')
  return set
}

interface SkillMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  mode: SkillEditorMode
  /** Render the name/description frontmatter fields in rich mode. Only the
   *  skill entrypoint (SKILL.md) carries frontmatter — on any other markdown
   *  file the fields would inject a YAML block the file never had. */
  showMetadata: boolean
  /** 1-based line to scroll to + flash (source mode). Bumping `revealNonce`
   *  re-triggers even for the same line — used by the scan findings panel. */
  revealLine?: number
  revealNonce?: number
}

export function SkillMarkdownEditor({
  value,
  onChange,
  mode,
  showMetadata,
  revealLine,
  revealNonce,
}: SkillMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const revealFlash = useRevealLine(textareaRef, value, revealLine, revealNonce, mode === 'source')
  const visualRef = useRef<HTMLDivElement>(null)
  const turndown = useMemo(() => createTurndown(), [])
  const preview = useMemo(() => skillMarkdownMetadata(value), [value])
  const bodyHtml = useMemo(() => markdownToEditorHtml(preview.body), [preview.body])
  // Frontmatter fields beyond name/description (argument-hint, allowed-tools,
  // model, license, …). Shown read-only in rich mode so nothing looks lost;
  // edit them in Markdown mode. Same flattening the read-only page uses.
  const descRef = useRef<HTMLTextAreaElement>(null)
  const extraFrontmatter = useMemo(() => {
    if (!showMetadata) return []
    const fm = splitSkillMdFrontmatter(value).frontmatter
    if (!fm) return []
    return frontmatterRows(fm).filter((r) => r.key !== 'name' && r.key !== 'description')
  }, [value, showMetadata])
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const [active, setActive] = useState<Set<string>>(() => new Set())
  // The name/description inputs are controlled from the parsed markdown, but
  // the frontmatter round-trip trims whitespace — so a trailing space would be
  // eaten on every keystroke. Hold the raw text in a draft while typing and
  // sync back to the canonical (normalized) value on blur.
  const [metaDrafts, setMetaDrafts] = useState<{ description?: string; name?: string }>({})

  useEffect(() => {
    if (mode !== 'rich') return
    const visual = visualRef.current
    if (!visual) return
    if (document.activeElement === visual || visual.contains(document.activeElement)) return
    if (visual.innerHTML !== bodyHtml) visual.innerHTML = bodyHtml
  }, [bodyHtml, mode])

  // Keep the description textarea sized to its wrapped content, so a long
  // description shows in full instead of clipping to one line.
  useEffect(() => {
    if (mode !== 'rich') return
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [mode, metaDrafts.description, preview.description])

  // Floating format bubble: appears over a non-empty selection inside the body.
  useEffect(() => {
    if (mode !== 'rich') {
      setBubble(null)
      return
    }
    const update = () => {
      const visual = visualRef.current
      const selection = window.getSelection()
      if (!visual || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setBubble(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!visual.contains(range.commonAncestorContainer)) {
        setBubble(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setBubble(null)
        return
      }
      setBubble({ top: rect.top, left: rect.left + rect.width / 2 })
      setActive(activeFormats(visual, selection))
    }
    const hide = () => setBubble(null)
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [mode])

  function applyVisualToolbarItem(item: (typeof toolbarItems)[number]) {
    const visual = visualRef.current
    if (!visual) return
    visual.focus()
    const isActive = active.has(item.title)

    if (item.visualCommand === 'createLink') {
      if (isActive) {
        document.execCommand('unlink')
      } else {
        const href = window.prompt('Link URL')
        if (!href) return
        document.execCommand('createLink', false, href)
      }
    } else if (item.visualCommand === 'formatBlock') {
      // formatBlock does not toggle, so an active block clears back to a paragraph.
      document.execCommand('formatBlock', false, isActive ? 'p' : (item.visualValue ?? 'p'))
    } else {
      // bold / italic / list toggle natively.
      document.execCommand(item.visualCommand, false, '')
    }

    updateMarkdownFromVisual()
  }

  function updateMarkdownFromVisual() {
    const visual = visualRef.current
    if (!visual) return
    const body = turndown.turndown(visual.innerHTML)
    onChange(replaceSkillBody(value, body))
  }

  function updateMetadata(field: 'description' | 'name', nextValue: string) {
    setMetaDrafts((drafts) => ({ ...drafts, [field]: nextValue }))
    onChange(replaceFrontmatterField(value, field, nextValue))
  }

  function commitMetadataDraft(field: 'description' | 'name') {
    setMetaDrafts((drafts) => ({ ...drafts, [field]: undefined }))
  }

  function handleVisualInput(_event: FormEvent<HTMLDivElement>) {
    updateMarkdownFromVisual()
  }

  function handleVisualKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') return
    // Chrome's contentEditable refuses to insert a newline inside a <pre> code
    // block on Enter (a long-standing quirk), so the caret looks stuck and the
    // only way to add a line is to switch to Markdown mode. execCommand swallows
    // the "\n" here too, so insert a real newline text node into the range
    // ourselves — turndown reads the code element's textContent, so this round-
    // trips as a real newline. Paragraphs fall through to native Enter.
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    let inPre = false
    for (let node: Node | null = selection.anchorNode; node && node !== visualRef.current; node = node.parentNode) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'PRE') {
        inPre = true
        break
      }
    }
    if (!inPre) return
    event.preventDefault()
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const newline = document.createTextNode('\n')
    range.insertNode(newline)
    // A lone trailing "\n" in a <pre> is not rendered by browsers, so when the
    // break lands at the very end of the block, pad it with one more and keep
    // the caret between them so the new empty line is visible.
    if (!newline.nextSibling || (newline.nextSibling.textContent ?? '') === '') {
      newline.parentNode?.insertBefore(document.createTextNode('\n'), newline.nextSibling)
    }
    const caret = document.createRange()
    caret.setStartAfter(newline)
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
    updateMarkdownFromVisual()
  }

  function handleSourceKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selected = value.slice(start, end) || 'bold text'
      const next = `${value.slice(0, start)}**${selected}**${value.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 2, start + 2 + selected.length)
      })
    }
  }

  if (mode === 'source') {
    return (
      // Relative + overflow-hidden so the scan-jump flash overlays the flagged
      // line and clips at the textarea's edges.
      <div className="relative h-full min-h-0 overflow-hidden">
        <textarea
          ref={textareaRef}
          aria-label="Markdown editor"
          className="skill-editor-textarea h-full"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleSourceKeyDown}
          placeholder="Write your skill instructions..."
          spellCheck={false}
        />
        {revealFlash}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="skill-editor-doc">
        <div className="skill-editor-doc-inner">
          {showMetadata && (
            <div className="skill-editor-frontmatter">
              <input
                className="skill-editor-title"
                aria-label="Skill name"
                value={metaDrafts.name ?? preview.name ?? ''}
                onChange={(event) => updateMetadata('name', event.target.value)}
                onBlur={() => commitMetadataDraft('name')}
                placeholder="skill-name"
              />
              <textarea
                ref={descRef}
                rows={1}
                className="skill-editor-subtitle"
                aria-label="Skill description"
                value={metaDrafts.description ?? preview.description ?? ''}
                onChange={(event) => updateMetadata('description', event.target.value)}
                onBlur={() => commitMetadataDraft('description')}
                onKeyDown={(event) => {
                  // A description is a single line of prose; Enter commits, it
                  // doesn't add a newline.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                placeholder="A short description of what this skill does."
              />
              {extraFrontmatter.length > 0 && (
                <dl className="skill-editor-fm-rows">
                  {extraFrontmatter.map((row, i) => (
                    <div key={`${row.key}-${i}`} className="contents">
                      <dt>{row.key}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
          <div
            ref={visualRef}
            aria-label="Visual editor"
            className="skill-editor-body skill-editor-visual"
            contentEditable
            suppressContentEditableWarning
            onInput={handleVisualInput}
            onKeyDown={handleVisualKeyDown}
          />
        </div>
      </div>

      {bubble && (
        <div
          className="skill-editor-bubble"
          style={{
            position: 'fixed',
            top: bubble.top,
            left: bubble.left,
            transform: 'translate(-50%, calc(-100% - 8px))',
          }}
        >
          {toolbarItems.map((item) => (
            <button
              key={item.title}
              type="button"
              title={item.title}
              aria-label={item.title}
              aria-pressed={active.has(item.title)}
              data-active={active.has(item.title)}
              className="skill-editor-bubble-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyVisualToolbarItem(item)}
            >
              {item.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
