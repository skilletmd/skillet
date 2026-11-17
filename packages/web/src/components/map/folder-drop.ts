import { classifyJob, type JobId } from '@skillet/protocol/jobs'
import { KIT_MAP_DESCRIPTION_MAX, KIT_MAP_NAME_MAX, type KitMapEntry, type KitMapScan } from '@skillet/protocol/kit-map'
import { fromSlugDir } from '@skillet/protocol/skill-id'
import { skillFrontmatterField } from '@/lib/skill-md-metadata'
import { canonicalContentHash, type DecodedBundle } from '@/lib/webcrypto-content-hash'

/**
 * The kit map from a skills folder dropped on /packs/home (plan U8, KTD15; R3,
 * R15, AE6): found, read, keyed and sorted in this tab, and sent nowhere.
 *
 * A folder arrives as a drop (FileSystemEntry) or from a directory input (a
 * FileList), and both become the same `FolderDir`, so choosing a folder and
 * dropping it give the same map.
 *
 * Finding skills is lazy. The reader lists folders at most FOLDER_DEPTH levels
 * below the chosen one, skips dot-folders and Skillet's router skill as the CLI
 * scan does, and stops at a folder holding SKILL.md: that folder is a skill,
 * and everything below it is the skill's. Only a skill's own files are read.
 * Past FOLDER_LIMITS it stops and calls the folder too big, so a folder dropped
 * a level too high doesn't freeze the tab.
 *
 * A skill's key is the CLI scan's (packages/core/src/map/scan.ts):
 * canonicalContentHash over its regular files at POSIX paths relative to its
 * folder, leaving out every name that starts with a dot, at any depth and with
 * everything inside, and names ending in `.skillet-backup`. node_modules,
 * __pycache__ and Thumbs.db stay in, as they do there, so this rule is not the
 * skill editor's `isJunkPath`. A browser shows no links: one it followed is
 * keyed here, where the CLI leaves links out.
 *
 * A folder says nothing about usage, other AI tools or plugins, so every skill
 * is the person's own (`local`), loaded by no tool, with usage unknown, and the
 * map marks nothing unused (AE6).
 */

// Protocol keeps these in bundle.ts beside node:crypto, which can't load in the
// browser. tests/folder-drop.test.ts pins each one to protocol's.
export const SKILL_FILE = 'SKILL.md'
export const BACKUP_SUFFIX = '.skillet-backup'
export const MAX_SKILL_BYTES = 25 * 1024 * 1024
export const MAX_INSTRUCTION_BYTES = 1024 * 1024
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

/** Protocol's `extractFrontmatterYaml`: the front matter block of a SKILL.md, or null. */
export function frontmatterYaml(text: string): string | null {
  return FRONTMATTER.exec(text)?.[1] ?? null
}

/** How far below the chosen folder the reader looks for skills. */
export const FOLDER_DEPTH = 3

export interface FolderLimits {
  /** Entries listed, files and folders together. */
  entries: number
  /** Bytes read from skills. */
  bytes: number
}

/** Room for skills that carry node_modules, thousands of files each; a home folder runs past it. */
export const FOLDER_LIMITS: FolderLimits = { entries: 30_000, bytes: 300 * 1024 * 1024 }

/** A file's size, then its bytes once they fit: what File and Blob give. */
export interface FolderBlob {
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface FolderFile {
  readonly kind: 'file'
  readonly name: string
  open(): Promise<FolderBlob>
}

export interface FolderDir {
  readonly kind: 'dir'
  readonly name: string
  /** What it holds, stopping early once that's more than `max`. */
  list(max: number): Promise<FolderItem[]>
}

export type FolderItem = FolderFile | FolderDir

export type FolderRead =
  /** The skills, as a scan the map draws. `missed` counts folders that couldn't be read. */
  | { kind: 'map'; scan: KitMapScan; missed: number }
  /** No folder with a SKILL.md in it. */
  | { kind: 'empty' }
  /** Past FOLDER_LIMITS: not a skills folder. */
  | { kind: 'too-big' }
  /** The folder itself, or every skill in it, couldn't be read. */
  | { kind: 'error' }

// ---------------------------------------------------------------------------
// The two ways a folder arrives
// ---------------------------------------------------------------------------

function fromEntry(entry: FileSystemEntry): FolderItem | null {
  if (entry.isFile) {
    const file = entry as FileSystemFileEntry
    return { kind: 'file', name: entry.name, open: () => new Promise<File>((ok, fail) => file.file(ok, fail)) }
  }
  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry
    return { kind: 'dir', name: entry.name, list: (max) => readEntries(dir.createReader(), max) }
  }
  return null
}

/** readEntries hands a folder over in batches: read until an empty one, or past `max`. */
function readEntries(reader: FileSystemDirectoryReader, max: number): Promise<FolderItem[]> {
  return new Promise((resolve, reject) => {
    const out: FolderItem[] = []
    const next = () =>
      reader.readEntries((batch) => {
        for (const entry of batch) {
          const item = fromEntry(entry)
          if (item) out.push(item)
        }
        if (batch.length === 0 || out.length > max) resolve(out)
        else next()
      }, reject)
    next()
  })
}

/** A folder with no name of its own, holding what was handed over side by side. */
const holding = (items: FolderItem[]): FolderDir => ({ kind: 'dir', name: '', list: async () => items })

const onlyDirs = (items: FolderItem[]) => items.filter((item): item is FolderDir => item.kind === 'dir')

/**
 * What a drop holds, read inside the drop event (the browser empties it after).
 * One folder is the chosen folder; several sit side by side, and loose files
 * are left out. Null when the browser handed over no entries at all.
 */
export function folderFromDrop(data: Pick<DataTransfer, 'items'> | null): FolderDir | null {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(data?.items ?? [])) {
    const entry = item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry) entries.push(entry)
  }
  if (entries.length === 0) return null
  const dirs = onlyDirs(entries.map(fromEntry).filter((item): item is FolderItem => item !== null))
  return dirs.length === 1 && entries.length === 1 ? dirs[0]! : holding(dirs)
}

interface Node {
  dirs: Map<string, Node>
  files: Map<string, File>
}

function asDir(name: string, node: Node): FolderDir {
  return {
    kind: 'dir',
    name,
    list: async () => [
      ...[...node.dirs].map(([child, sub]) => asDir(child, sub)),
      ...[...node.files].map(([child, file]): FolderFile => ({ kind: 'file', name: child, open: async () => file })),
    ],
  }
}

/** A directory input's files, each with its path under the chosen folder, as that folder. */
export function folderFromFiles(files: ArrayLike<File> | Iterable<File>): FolderDir {
  const top: Node = { dirs: new Map(), files: new Map() }
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter((part) => part !== '')
    const name = parts.pop()
    if (name === undefined) continue
    let node = top
    for (const part of parts) {
      let next = node.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: new Map() }
        node.dirs.set(part, next)
      }
      node = next
    }
    node.files.set(name, file)
  }
  // Every path starts with the chosen folder's name, so there is one folder on top.
  const dirs = [...top.dirs].map(([name, node]) => asDir(name, node))
  return dirs.length === 1 && top.files.size === 0 ? dirs[0]! : holding(dirs)
}

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------

/** Thrown inside a read past FOLDER_LIMITS; it never leaves this module. */
const TOO_BIG = Symbol('too big')
/** Files opened, then read, at once. */
const READ_BATCH = 64
/** What the CLI accepts as a maker in Skillet's `owner--slug` folders (core's folder-rules.ts). */
const MAKER_RE = /^[a-z0-9-]{1,40}$/

const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Dot-folders anywhere and Skillet's router skill are never shown (core's `isSkippedName`). */
function isSkippedName(name: string): boolean {
  if (name.startsWith('.')) return true
  const parsed = fromSlugDir(name)
  return parsed !== null && parsed.owner === 'skillet' && parsed.slug === 'route'
}

/** A skill folder's slug: its name less Skillet's `_local--` or `owner--` prefix (core's `ruleForSkillFolder`). */
function slugOf(folder: string): string {
  const parsed = fromSlugDir(folder)
  return parsed !== null && (parsed.owner === null || MAKER_RE.test(parsed.owner)) ? parsed.slug : folder
}

/** One line: control characters and runs of whitespace become one space (the CLI's wire rule). */
function oneLine(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max)
}

/** A SKILL.md's name, description and body, as gray-matter splits them for the CLI. */
function readSkillMd(text: string): { name: string; description: string; body: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) return { name: '', description: '', body: text }
  const yaml = match[1] ?? ''
  return {
    name: skillFrontmatterField(yaml, 'name') ?? '',
    description: skillFrontmatterField(yaml, 'description') ?? '',
    body: text.slice(match[0].length).replace(/^\r?\n/, ''),
  }
}

interface ReadSkill {
  key: string
  name: string
  description: string
  job: JobId | null
  /** Why it can't be backed up, in the CLI's order: too big, instructions too big, a .git folder. */
  cantBackUp: string[]
  extraFiles: boolean
}

/** Read the skills in `root` and lay them out as a scan (see the module comment). */
export async function readSkillsFolder(root: FolderDir, limits: FolderLimits = FOLDER_LIMITS): Promise<FolderRead> {
  let listed = 0
  let bytes = 0
  let missed = 0

  const list = async (dir: FolderDir) => {
    const items = await dir.list(limits.entries - listed)
    listed += items.length
    if (listed > limits.entries) throw TOO_BIG
    return [...items].sort((a, b) => compareNames(a.name, b.name))
  }

  // Find: a folder holding SKILL.md is a skill, and nothing below it is looked at.
  const found: { folder: string; items: FolderItem[] }[] = []
  const look = async (dir: FolderDir, depth: number): Promise<void> => {
    const items = await list(dir)
    if (items.some((item) => item.kind === 'file' && item.name === SKILL_FILE)) {
      found.push({ folder: dir.name, items })
      return
    }
    if (depth === FOLDER_DEPTH) return
    for (const item of items) {
      if (item.kind !== 'dir' || isSkippedName(item.name)) continue
      try {
        await look(item, depth + 1)
      } catch (err) {
        if (err === TOO_BIG) throw err
        missed += 1
      }
    }
  }

  // Read: the skill's files by the CLI's rule, sizes checked before any bytes.
  const readSkill = async ({ folder, items }: (typeof found)[number]): Promise<ReadSkill> => {
    const files: { path: string; file: FolderFile }[] = []
    let hasGit = false
    const walk = async (entries: FolderItem[], rel: string): Promise<void> => {
      for (const item of entries) {
        if (item.name === '.git') {
          hasGit = true
          continue
        }
        if (item.name.startsWith('.') || item.name.endsWith(BACKUP_SUFFIX)) continue
        const path = rel === '' ? item.name : `${rel}/${item.name}`
        if (item.kind === 'dir') await walk(await list(item), path)
        else files.push({ path, file: item })
      }
    }
    await walk(items, '')

    const bundle: DecodedBundle = new Map()
    let total = 0
    for (let at = 0; at < files.length; at += READ_BATCH) {
      const batch = files.slice(at, at + READ_BATCH)
      const blobs = await Promise.all(batch.map(({ file }) => file.open()))
      const size = blobs.reduce((n, blob) => n + blob.size, 0)
      if (bytes + size > limits.bytes) throw TOO_BIG
      bytes += size
      const buffers = await Promise.all(blobs.map((blob) => blob.arrayBuffer()))
      batch.forEach(({ path }, n) => {
        const data = new Uint8Array(buffers[n]!)
        bundle.set(path, data)
        total += data.byteLength
      })
    }

    const entrypoint = bundle.get(SKILL_FILE) ?? new Uint8Array(0)
    const md = readSkillMd(new TextDecoder().decode(entrypoint))
    const slug = slugOf(folder)
    const name = md.name || slug
    const cantBackUp: string[] = []
    if (total > MAX_SKILL_BYTES) cantBackUp.push('over-25-mb')
    // The CLI counts SKILL.md plus what its required_reading pulls in; SKILL.md alone covers nearly every skill.
    if (entrypoint.byteLength > MAX_INSTRUCTION_BYTES) cantBackUp.push('instructions-over-1-mb')
    if (hasGit) cantBackUp.push('git-folder')
    return {
      key: await canonicalContentHash(bundle),
      name,
      description: md.description,
      job: classifyJob({ slug, name, description: md.description, body: md.body }),
      cantBackUp,
      extraFiles: bundle.size > 1,
    }
  }

  try {
    await look(root, 0)
  } catch (err) {
    return { kind: err === TOO_BIG ? 'too-big' : 'error' }
  }
  if (found.length === 0) return { kind: 'empty' }

  // Identical copies are one skill, as in the CLI scan: the first in folder order leads, flags add up.
  const byKey = new Map<string, ReadSkill>()
  for (const skill of found) {
    let read: ReadSkill
    try {
      read = await readSkill(skill)
    } catch (err) {
      if (err === TOO_BIG) return { kind: 'too-big' }
      missed += 1
      continue
    }
    const lead = byKey.get(read.key)
    if (!lead) byKey.set(read.key, read)
    else lead.cantBackUp = [...new Set([...lead.cantBackUp, ...read.cantBackUp])]
  }
  if (byKey.size === 0) return { kind: 'error' }

  const entries = [...byKey.values()]
    .sort((a, b) => compareNames(a.name.toLowerCase(), b.name.toLowerCase()) || compareNames(a.key, b.key))
    .map(toEntry)
  return { kind: 'map', scan: { entries, looked: [], unchecked: [] }, missed }
}

const BACKUP_ORDER = ['over-25-mb', 'instructions-over-1-mb', 'git-folder']

/** A read skill as the map takes it, shaped as the CLI shapes its own (map-cmd.ts). */
function toEntry(skill: ReadSkill): KitMapEntry {
  const entry: KitMapEntry = {
    key: skill.key,
    name: cut(oneLine(skill.name), KIT_MAP_NAME_MAX).trim() || 'Unnamed skill',
    description: cut(oneLine(skill.description), KIT_MAP_DESCRIPTION_MAX),
    source: 'local',
    tools: [],
    job: skill.job,
    // No history was read: the CLI's word for a skill it has no usage for.
    usage: { state: 'unknown', reason: 'no-history' },
  }
  const noBackup = BACKUP_ORDER.find((reason) => skill.cantBackUp.includes(reason))
  if (noBackup) entry.noBackup = { reason: noBackup }
  if (skill.extraFiles) entry.noMerge = { reason: 'extra-files' }
  return entry
}
