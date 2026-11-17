// The kit map from a dropped folder (plan U8, KTD15; R3, R15, AE6).
//
// The browser finds, reads, keys and sorts a skills folder itself, so a dropped
// skill must get the key `skillet map` gives it. The parity block pins the
// reader's keys, jobs and flags to the values core's scan computed for these
// exact bytes (packages/core/src/map/scan.ts, run from source over a throwaway
// home), and to protocol's canonicalContentHash over the CLI rule's file set,
// walked here on disk. The rest drives the reader through both ways a folder
// arrives, and the /packs/home page around it. Nothing here reads the real home
// directory: fixtures live in memory and in a temp folder.

import { createElement, type ReactNode } from 'react'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  MAX_BUNDLE_BYTES,
  MAX_INSTRUCTION_BYTES as PROTOCOL_MAX_INSTRUCTION_BYTES,
  SKILLET_BACKUP_SUFFIX,
  SKILL_ENTRYPOINT,
  canonicalContentHash,
  extractFrontmatterYaml,
} from '@skillet/protocol'
import { classifyJob } from '@skillet/protocol/jobs'
import { parseKitMapScan, type KitMapScan } from '@skillet/protocol/kit-map'
import {
  BACKUP_SUFFIX,
  FOLDER_DEPTH,
  FOLDER_LIMITS,
  MAX_INSTRUCTION_BYTES,
  MAX_SKILL_BYTES,
  SKILL_FILE,
  folderFromDrop,
  folderFromFiles,
  frontmatterYaml,
  readSkillsFolder,
  type FolderRead,
} from '@/components/map/folder-drop'
import { HomeKit } from '@/components/packs/home-kit'

vi.mock('next/link', async () => {
  const react = await import('react')
  return {
    default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
      react.createElement('a', { href, ...props }, children),
  }
})

// ---------------------------------------------------------------------------
// Fixtures: a folder as a tree, handed over the two ways a browser does
// ---------------------------------------------------------------------------

type Tree = { [name: string]: string | Uint8Array | Tree }
type Leaf = string | Uint8Array

const isLeaf = (node: Leaf | Tree): node is Leaf => typeof node === 'string' || node instanceof Uint8Array
const bytesOf = (leaf: Leaf) => (typeof leaf === 'string' ? new TextEncoder().encode(leaf) : leaf)
const skillMd = (name: string, description = `${name}, for tests.`) => `---\nname: ${name}\ndescription: ${description}\n---\n${name}.\n`

/** What the reader touched: folders listed, files opened, bytes read. */
interface Log {
  listed: string[]
  opened: string[]
  read: string[]
}
const newLog = (): Log => ({ listed: [], opened: [], read: [] })

/** A file as File gives it: its size first, its bytes only when asked. */
function blobOf(bytes: Uint8Array, path: string, log: Log, size = bytes.byteLength) {
  return {
    size,
    arrayBuffer: async () => {
      log.read.push(path)
      return bytes.slice().buffer
    },
  }
}

/** A dropped folder as Chrome hands it over: entries in batches of 100, a file only on request. */
function entryOf(name: string, node: Leaf | Tree, log: Log, path = name): FileSystemEntry {
  if (isLeaf(node)) {
    const bytes = bytesOf(node)
    return {
      isFile: true,
      isDirectory: false,
      name,
      fullPath: `/${path}`,
      file: (ok: (file: File) => void) => {
        log.opened.push(path)
        queueMicrotask(() => ok(blobOf(bytes, path, log) as unknown as File))
      },
    } as unknown as FileSystemEntry
  }
  const children = Object.entries(node).map(([child, sub]) => entryOf(child, sub, log, `${path}/${child}`))
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${path}`,
    createReader: () => {
      let at = 0
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          if (at === 0) log.listed.push(path)
          const batch = children.slice(at, at + 100)
          at += batch.length
          queueMicrotask(() => ok(batch))
        },
      }
    },
  } as unknown as FileSystemEntry
}

/** A drop's DataTransfer, holding these entries. */
function dropOf(...entries: FileSystemEntry[]) {
  return {
    types: ['Files'],
    files: [],
    items: entries.map((entry) => ({ kind: 'file', type: '', webkitGetAsEntry: () => entry })),
  } as unknown as DataTransfer
}

const dropped = (name: string, tree: Tree, log = newLog()) => folderFromDrop(dropOf(entryOf(name, tree, log)))

/** The same folder through a directory input: every file, with its path under the chosen folder. */
function filesOf(root: string, tree: Tree, log: Log, prefix = root): File[] {
  return Object.entries(tree).flatMap(([name, node]) => {
    const path = `${prefix}/${name}`
    if (!isLeaf(node)) return filesOf(root, node, log, path)
    const bytes = bytesOf(node)
    return [{ name, webkitRelativePath: path, ...blobOf(bytes, path, log) } as unknown as File]
  })
}

function mapOf(read: FolderRead): { scan: KitMapScan; missed: number } {
  if (read.kind !== 'map') throw new Error(`expected a map, got ${read.kind}`)
  return read
}

// ---------------------------------------------------------------------------
// Parity with the CLI scan
// ---------------------------------------------------------------------------

const ramp = Uint8Array.from({ length: 256 }, (_, n) => n)

/** Byte for byte the fixtures core's scan was run on. */
const PARITY: Tree = {
  'plain-prose': {
    'SKILL.md': '---\nname: Plain Prose\ndescription: Edit a draft into plain prose.\n---\n# Plain Prose\n\nCut filler words. Keep one idea per sentence.\n',
    'notes.md': 'Keep it short.\n',
  },
  'logo-kit': {
    'SKILL.md': '---\nname: Logo Kit\ndescription: Make logos and icons.\n---\nUse the files in assets.\n',
    assets: {
      'mark.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ramp]),
      'empty.txt': new Uint8Array(0),
    },
  },
  'deep-research': {
    'SKILL.md': '---\nname: Deep Research\ndescription: Research a topic across the web and write a report.\n---\nRead the references first.\n',
    references: { sources: { 'primary.md': 'Primary sources first.\n', deep: { 'notes.md': 'Three folders down.\n' } } },
    scripts: { 'fetch.sh': '#!/bin/sh\necho fetch\n' },
  },
  'windows-notes': {
    'SKILL.md': '---\r\nname: Windows Notes\r\ndescription: Notes kept with CRLF line endings.\r\n---\r\n# Windows Notes\r\n\r\nLine one.\r\n',
    'guide.md': 'Step one.\r\nStep two.\r\n',
  },
  'tidy-folder': {
    'SKILL.md': '---\nname: Tidy Folder\ndescription: Keep a folder tidy.\n---\nTidy up.\n',
    '.DS_Store': Uint8Array.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31]),
    '.cache': { 'state.json': '{"seen":true}\n' },
    docs: { '.DS_Store': Uint8Array.from([0, 0, 0, 1]), 'howto.md': 'How to tidy.\n' },
    'SKILL.md.skillet-backup': 'An older copy.\n',
    // The CLI keeps these, unlike the skill editor's junk rule.
    'Thumbs.db': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
    node_modules: { 'left-pad': { 'index.js': 'module.exports = (s) => s\n' } },
    __pycache__: { 'tidy.cpython-312.pyc': Uint8Array.from([0x33, 0x0d, 0x0d, 0x0a]) },
  },
  'git-notes': {
    'SKILL.md': '---\nname: Git Notes\ndescription: Notes that live in a git repo.\n---\nCommit often.\n',
    '.git': { HEAD: 'ref: refs/heads/main\n' },
  },
}

/**
 * What core's scan gave each fixture, in the order it sorts them. Computed by
 * running scanMap from packages/core/src over PARITY written to a temp home.
 */
const CORE = [
  {
    fixture: 'nested folders',
    folder: 'deep-research',
    name: 'Deep Research',
    key: 'sha256:0d59e57ad890cab6ae4d878aac251bd27d96d27990aa21b7e6b4965842edb48b',
    job: 'research.web-research',
    noMerge: 'extra-files',
  },
  {
    fixture: 'a .git folder',
    folder: 'git-notes',
    name: 'Git Notes',
    key: 'sha256:f12ce9a8b33241b2d3ad2c033995961de40fce95288cf9b0a3b78f052dc2a8c2',
    job: null,
    noBackup: 'git-folder',
  },
  {
    fixture: 'binary',
    folder: 'logo-kit',
    name: 'Logo Kit',
    key: 'sha256:86dbcec2e960cdf9c70fefb1a2c14d8de56f6e48136e6058b7491e7d41638c3c',
    job: 'design.images',
    noMerge: 'extra-files',
  },
  {
    fixture: 'text only',
    folder: 'plain-prose',
    name: 'Plain Prose',
    key: 'sha256:3bc61448584530d058dcf7e75ef95d142122a4d15dec11b9473c65eafeb8f8c6',
    job: 'writing.editing',
    noMerge: 'extra-files',
  },
  {
    fixture: '.DS_Store and a dot-folder',
    folder: 'tidy-folder',
    name: 'Tidy Folder',
    key: 'sha256:9c97c682aa546a7c2f906e8abf73d6512b239cd6206219298da595e79c90b2dd',
    job: null,
    noMerge: 'extra-files',
  },
  {
    fixture: 'CRLF line endings',
    folder: 'windows-notes',
    name: 'Windows Notes',
    key: 'sha256:6589a315888b4662c66954a13ce781f18296c80ee4022b9290ccce03fd3146af',
    job: null,
    noMerge: 'extra-files',
  },
] as const

function writeTree(dir: string, tree: Tree) {
  mkdirSync(dir, { recursive: true })
  for (const [name, node] of Object.entries(tree)) {
    if (isLeaf(node)) writeFileSync(join(dir, name), bytesOf(node))
    else writeTree(join(dir, name), node)
  }
}

/** The CLI scan's file rule (walkSkill in packages/core/src/map/scan.ts), walked on disk. */
function cliBundle(dir: string, rel = '', out = new Map<string, Uint8Array>()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith(SKILLET_BACKUP_SUFFIX)) continue
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) cliBundle(join(dir, entry.name), path, out)
    else if (entry.isFile()) out.set(path, readFileSync(join(dir, entry.name)))
  }
  return out
}

describe('a dropped skill gets the key the CLI scan gives it', () => {
  let disk = ''
  let scan: KitMapScan

  beforeAll(async () => {
    disk = mkdtempSync(join(tmpdir(), 'folder-drop-'))
    writeTree(join(disk, 'skills'), PARITY)
    scan = mapOf(await readSkillsFolder(dropped('skills', PARITY)!)).scan
  })
  afterAll(() => rmSync(disk, { recursive: true, force: true }))

  it('sorts the skills as the CLI does', () => {
    expect(scan.entries.map((e) => e.name)).toEqual(CORE.map((c) => c.name))
  })

  it.each(CORE)('$fixture: same key, job and flags as core', (core) => {
    const entry = scan.entries.find((e) => e.name === core.name)!
    expect(entry.key).toBe(core.key)
    // The same key, from protocol's hash over the CLI rule's files on disk.
    expect(entry.key).toBe(canonicalContentHash(cliBundle(join(disk, 'skills', core.folder))))
    expect(entry.job).toBe(core.job)
    expect(entry.noBackup?.reason).toBe('noBackup' in core ? core.noBackup : undefined)
    expect(entry.noMerge?.reason).toBe('noMerge' in core ? core.noMerge : undefined)
  })

  it('mirrors the protocol values it cannot import in the browser', () => {
    expect(SKILL_FILE).toBe(SKILL_ENTRYPOINT)
    expect(BACKUP_SUFFIX).toBe(SKILLET_BACKUP_SUFFIX)
    expect(MAX_SKILL_BYTES).toBe(MAX_BUNDLE_BYTES)
    expect(MAX_INSTRUCTION_BYTES).toBe(PROTOCOL_MAX_INSTRUCTION_BYTES)
    for (const text of [
      '---\nname: a\n---\nbody',
      '---\r\nname: a\r\n---\r\nbody',
      '---\n---\nempty',
      'no front matter',
      '---\nname: unclosed\n',
      '\n---\nname: late\n---\n',
    ]) {
      expect(frontmatterYaml(text)).toBe(extractFrontmatterYaml(text))
    }
  })

  it('builds a scan the bridge accepts, with nothing marked unused', () => {
    expect(parseKitMapScan(scan)).not.toBeNull()
    expect(scan.looked).toEqual([])
    expect(scan.unchecked).toEqual([])
    for (const entry of scan.entries) {
      expect(entry.source).toBe('local')
      expect(entry.tools).toEqual([])
      expect(entry.usage.state).toBe('unknown')
    }
  })
})

// ---------------------------------------------------------------------------
// Finding the skills
// ---------------------------------------------------------------------------

describe('readSkillsFolder', () => {
  it('builds three entries from three skills, one of them nested', async () => {
    const tree: Tree = {
      'code-review': { 'SKILL.md': skillMd('Code Review', 'Review a pull request.'), examples: { 'SKILL.md': 'part of code-review' } },
      'thread-writer': { 'SKILL.md': skillMd('Thread Writer') },
      team: { 'meeting-notes': { 'SKILL.md': skillMd('Meeting Notes') } },
    }
    const { scan } = mapOf(await readSkillsFolder(dropped('skills', tree)!))
    expect(scan.entries.map((e) => e.name)).toEqual(['Code Review', 'Meeting Notes', 'Thread Writer'])
    // A SKILL.md inside a skill's own folder is one of its files, not a skill of its own.
    expect(scan.entries[0]!.noMerge?.reason).toBe('extra-files')
    expect(scan.entries[0]!.job).toBe(
      classifyJob({ slug: 'code-review', name: 'Code Review', description: 'Review a pull request.', body: 'Code Review.\n' }),
    )
  })

  it('gives the same entries for a chosen folder as for a dropped one', async () => {
    const drop = await readSkillsFolder(dropped('skills', PARITY)!)
    const chosen = await readSkillsFolder(folderFromFiles(filesOf('skills', PARITY, newLog())))
    expect(chosen).toEqual(drop)
  })

  it('says empty when no folder holds a SKILL.md', async () => {
    const tree: Tree = { notes: { 'README.md': '# Notes\n' }, 'todo.txt': 'nothing here\n' }
    expect(await readSkillsFolder(dropped('Documents', tree)!)).toEqual({ kind: 'empty' })
    expect(await readSkillsFolder(folderFromFiles([]))).toEqual({ kind: 'empty' })
  })

  it('finds the skills when the folder above the skills folder is dropped', async () => {
    const tree: Tree = {
      skills: { 'plain-prose': { 'SKILL.md': skillMd('Plain Prose') }, team: { notes: { 'SKILL.md': skillMd('Notes') } } },
      projects: { app: { 'log.jsonl': '{}\n' } },
    }
    const { scan } = mapOf(await readSkillsFolder(dropped('.claude', tree)!))
    expect(scan.entries.map((e) => e.name)).toEqual(['Notes', 'Plain Prose'])
  })

  it('reads one dropped skill folder as one skill', async () => {
    const { scan } = mapOf(await readSkillsFolder(dropped('plain-prose', { 'SKILL.md': '# No front matter\n' })!))
    // No name in its front matter: the folder's name, as the CLI does.
    expect(scan.entries.map((e) => e.name)).toEqual(['plain-prose'])
  })

  it(`looks ${FOLDER_DEPTH} levels down at most, past dot-folders and Skillet's router skill`, async () => {
    const tree: Tree = {
      a: { b: { c: { 'SKILL.md': skillMd('Three Down') }, d: { e: { 'SKILL.md': skillMd('Four Down') } } } },
      '.hidden': { 'SKILL.md': skillMd('Hidden') },
      skillet: { 'SKILL.md': skillMd('Router') },
      'skillet--route': { 'SKILL.md': skillMd('Router Too') },
    }
    const { scan } = mapOf(await readSkillsFolder(dropped('skills', tree)!))
    expect(scan.entries.map((e) => e.name)).toEqual(['Three Down'])
  })

  it("reads bytes only for a skill's own files", async () => {
    const log = newLog()
    const tree: Tree = {
      skills: { 'plain-prose': { 'SKILL.md': skillMd('Plain Prose'), 'notes.md': 'notes\n' } },
      projects: { app: { 'log.jsonl': '{}\n', 'big.bin': new Uint8Array(1024) } },
      'README.md': '# Home\n',
    }
    mapOf(await readSkillsFolder(dropped('home', tree, log)!))
    expect(log.opened.sort()).toEqual(['home/skills/plain-prose/SKILL.md', 'home/skills/plain-prose/notes.md'])
    expect(log.read.sort()).toEqual(log.opened)
  })

  it("stops past the entry cap without listing every folder: not a skills folder", async () => {
    const log = newLog()
    const tree: Tree = Object.fromEntries(
      Array.from({ length: 40 }, (_, n) => [`project-${n}`, Object.fromEntries(Array.from({ length: 40 }, (_, m) => [`file-${m}.txt`, 'x']))]),
    )
    const read = await readSkillsFolder(dropped('Documents', tree, log)!, { ...FOLDER_LIMITS, entries: 200 })
    expect(read).toEqual({ kind: 'too-big' })
    expect(log.listed.length).toBeLessThan(41)
    expect(log.opened).toEqual([])
  })

  it('stops past the byte cap without reading every file', async () => {
    const log = newLog()
    const big: Tree = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`part-${n}.bin`, new Uint8Array(1024)]))
    const tree: Tree = { 'big-skill': { 'SKILL.md': skillMd('Big Skill'), parts: big } }
    const read = await readSkillsFolder(dropped('skills', tree, log)!, { ...FOLDER_LIMITS, bytes: 64 * 1024 })
    expect(read).toEqual({ kind: 'too-big' })
    expect(log.read.length).toBeLessThan(201)
  })

  it('never reads a file past the byte cap, however large', async () => {
    const huge = {
      isFile: true,
      isDirectory: false,
      name: 'video.mov',
      file: (ok: (file: File) => void) =>
        ok({
          size: FOLDER_LIMITS.bytes + 1,
          arrayBuffer: () => {
            throw new Error('read past the cap')
          },
        } as unknown as File),
    } as unknown as FileSystemEntry
    const log = newLog()
    const skill = entryOf('clip-maker', { 'SKILL.md': skillMd('Clip Maker') }, log)
    const reader = (skill as FileSystemDirectoryEntry).createReader()
    const withHuge = {
      ...skill,
      isFile: false,
      isDirectory: true,
      name: 'clip-maker',
      createReader: () => {
        let done = false
        return {
          readEntries: (ok: (batch: FileSystemEntry[]) => void, fail: (err: unknown) => void) =>
            done ? ok([]) : reader.readEntries((batch) => {
              done = true
              ok([...batch, huge])
            }, fail),
        }
      },
    } as unknown as FileSystemEntry
    expect(await readSkillsFolder(folderFromDrop(dropOf(withHuge))!)).toEqual({ kind: 'too-big' })
  })

  it('lists a folder in every batch readEntries hands over', async () => {
    const many: Tree = Object.fromEntries(Array.from({ length: 250 }, (_, n) => [`skill-${String(n).padStart(3, '0')}`, { 'SKILL.md': skillMd(`Skill ${n}`) }]))
    const { scan } = mapOf(await readSkillsFolder(dropped('skills', many)!))
    expect(scan.entries).toHaveLength(250)
  })

  it('counts identical copies once and flags a skill too big to back up', async () => {
    const tree: Tree = {
      'plain-prose': { 'SKILL.md': skillMd('Plain Prose') },
      'plain-prose-copy': { 'SKILL.md': skillMd('Plain Prose') },
      'clip-maker': { 'SKILL.md': skillMd('Clip Maker'), 'clip.mov': new Uint8Array(MAX_SKILL_BYTES) },
    }
    const { scan } = mapOf(await readSkillsFolder(dropped('skills', tree)!))
    expect(scan.entries.map((e) => e.name)).toEqual(['Clip Maker', 'Plain Prose'])
    expect(scan.entries[0]!.noBackup?.reason).toBe('over-25-mb')
  })

  it('keeps reading past a folder it cannot open, and counts it', async () => {
    const broken = {
      isFile: false,
      isDirectory: true,
      name: 'locked',
      createReader: () => ({ readEntries: (_ok: unknown, fail: (err: unknown) => void) => fail(new Error('NotReadableError')) }),
    } as unknown as FileSystemEntry
    const good = entryOf('plain-prose', { 'SKILL.md': skillMd('Plain Prose') }, newLog())
    const read = mapOf(await readSkillsFolder(folderFromDrop(dropOf(good, broken))!))
    expect(read.scan.entries.map((e) => e.name)).toEqual(['Plain Prose'])
    expect(read.missed).toBe(1)
  })

  it('says nothing came through when a drop holds no entries', () => {
    expect(folderFromDrop({ items: [], types: ['Files'] } as unknown as DataTransfer)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The page: /packs/home offers the line and takes a folder
// ---------------------------------------------------------------------------

describe('/packs/home', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const page = () => render(createElement(HomeKit))
  const zone = () => screen.getByRole('region', { name: 'Drop your skills folder here' })
  const dropOn = (data: DataTransfer) => fireEvent.drop(zone(), { dataTransfer: data })
  const THREE: Tree = {
    'code-review': { 'SKILL.md': skillMd('Code Review', 'Review a pull request.') },
    'thread-writer': { 'SKILL.md': skillMd('Thread Writer') },
    team: { 'meeting-notes': { 'SKILL.md': skillMd('Meeting Notes') } },
  }

  it('offers the line, with what it does and the way in without Node', () => {
    page()
    expect(screen.getByText('npx -y skilletmd map')).toBeInTheDocument()
    expect(screen.getByText(/Reads your skills\. Changes nothing and uploads nothing until you Save\. Needs Node\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose your folder' })).toHaveAttribute('href', '#folder')
    expect(zone()).toHaveAttribute('id', 'folder')
    expect(screen.getByText(/Files stay in this browser until you Save\./)).toBeInTheDocument()
    // The demo actions stay as they were.
    expect(screen.getByRole('button', { name: 'Find my gaps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill my kit' })).toBeInTheDocument()
  })

  it('copies the line and says so', async () => {
    writeText.mockResolvedValue(undefined)
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('npx -y skilletmd map')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('says when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Copy didn't work. Select the text above instead.")
  })

  it('draws the map from a dropped folder, marks nothing unused and names what it did not check (AE6)', async () => {
    page()
    dropOn(dropOf(entryOf('skills', THREE, newLog())))
    expect(screen.getByText('Reading your skills…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: '3 skills, sorted by job' })).toBeInTheDocument()
    expect(screen.getByText(/Didn't check other AI tools, plugins or usage\./)).toBeInTheDocument()
    expect(screen.queryByText('unused')).toBeNull()
    expect(screen.queryByText(/No runs in 30 days/)).toBeNull()
    // Nothing leaves the browser: Save waits for a later step.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/Your files stay in this browser\./)).toBeInTheDocument()
  })

  it('takes a folder dropped anywhere on the page', async () => {
    page()
    fireEvent.drop(screen.getByRole('heading', { level: 1, name: 'A skill for every job' }), {
      dataTransfer: dropOf(entryOf('skills', THREE, newLog())),
    })
    expect(await screen.findByRole('heading', { level: 1, name: '3 skills, sorted by job' })).toBeInTheDocument()
  })

  it('draws the same map from Choose folder', async () => {
    const { container } = page()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input).toHaveAttribute('webkitdirectory')
    fireEvent.change(input, { target: { files: filesOf('skills', THREE, newLog()) } })
    expect(await screen.findByRole('heading', { level: 1, name: '3 skills, sorted by job' })).toBeInTheDocument()
  })

  it('Start over goes back to the empty preview', async () => {
    page()
    dropOn(dropOf(entryOf('skills', THREE, newLog())))
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('heading', { level: 1, name: 'A skill for every job' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: '3 skills, sorted by job' })).toBeNull()
    expect(zone()).toBeInTheDocument()
  })

  it('says so in one line when the folder holds no skills', async () => {
    page()
    dropOn(dropOf(entryOf('Documents', { 'notes.md': '# Notes\n' }, newLog())))
    expect(await screen.findByText('No skills in that folder.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'A skill for every job' })).toBeInTheDocument()
  })

  it('says a folder past the cap is not a skills folder', async () => {
    page()
    const huge = {
      isFile: true,
      isDirectory: false,
      name: 'everything.zip',
      file: (ok: (file: File) => void) =>
        ok({ size: FOLDER_LIMITS.bytes + 1, arrayBuffer: () => Promise.reject(new Error('read')) } as unknown as File),
    } as unknown as FileSystemEntry
    const folder = {
      isFile: false,
      isDirectory: true,
      name: 'Downloads',
      createReader: () => {
        let done = false
        return {
          readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
            const batch = done ? [] : [entryOf('SKILL.md', skillMd('Everything'), newLog()), huge]
            done = true
            queueMicrotask(() => ok(batch))
          },
        }
      },
    } as unknown as FileSystemEntry
    dropOn(dropOf(folder))
    expect(await screen.findByText("That doesn't look like a skills folder.")).toBeInTheDocument()
  })
})
