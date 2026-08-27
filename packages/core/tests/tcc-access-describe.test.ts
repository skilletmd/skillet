/**
 * describeTccRoot — the REPORTING half of the TCC access model.
 *
 * assessTccRoot is the probing gate: for a user-initiated run it performs the
 * readdir macOS gates, which is the whole point (that read is the consent
 * moment). That makes it the wrong primitive for a status readout — a surface
 * that merely wants to SAY "this folder needs access" must never be the thing
 * that raises the dialog.
 *
 * describeTccRoot answers the same question from paths and the grant store
 * alone: is this root under a protected anchor, which anchor, and what grant
 * does the named context hold. No filesystem read beyond realpath resolution.
 *
 * Isolation: HOME and SKILLET_DIR are overridden via vi.hoisted before
 * @skillet/core loads (same harness as tcc-unlock.test.ts), so the grant store
 * is a throwaway temp file and the decoy Documents lives under a hermetic HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmod, mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { symlinksAvailable } from './symlink-support.js'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-tcc-describe')
})

import {
  describeTccRoot,
  recordTccGrant,
  suspendTccGrant,
} from '../src/util/tcc-access.js'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const DOCUMENTS = join(TEST_ROOT, 'Documents')
const DECOY_DIR = join(DOCUMENTS, 'claude-skills')
const GRANTS_PATH = join(TEST_ROOT, '.skillet', 'tcc-access.json')

beforeEach(async () => {
  // The policy is macOS-only; force it on so the decoy folders park on any CI box.
  process.env['SKILLET_TCC_POLICY'] = 'force'
  await mkdir(CLAUDE_DIR, { recursive: true })
  await mkdir(DECOY_DIR, { recursive: true })
  await rm(GRANTS_PATH, { force: true })
})

afterEach(async () => {
  delete process.env['SKILLET_TCC_POLICY']
  await rm(GRANTS_PATH, { force: true })
})

describe('describeTccRoot', () => {
  it('reports a normal dotfolder root as unprotected, with no anchor', () => {
    expect(describeTccRoot(CLAUDE_DIR, 'desktop')).toEqual({
      protected: false,
      grant: 'none',
      anchor: null,
    })
  })

  it('reports a root inside ~/Documents as protected, naming the anchor', () => {
    const got = describeTccRoot(DECOY_DIR, 'desktop')
    expect(got.protected).toBe(true)
    expect(got.anchor).toBe(realpathSync(DOCUMENTS))
  })

  it.skipIf(!symlinksAvailable)('resolves the anchor through a symlink, not the link’s parent', async () => {
    const link = join(TEST_ROOT, '.claude', 'linked-skills')
    await symlink(DECOY_DIR, link, 'dir')
    const got = describeTccRoot(link, 'desktop')
    // The LINK sits under ~/.claude, which is not protected. Its target is in
    // Documents, and the target is what a read would actually touch.
    expect(got.protected).toBe(true)
    expect(got.anchor).toBe(realpathSync(DOCUMENTS))
  })

  it('reports an active grant only to the context that earned it', () => {
    recordTccGrant(DECOY_DIR, 'desktop')
    expect(describeTccRoot(DECOY_DIR, 'desktop').grant).toBe('active')
    // A grant earned under the tray says nothing about the terminal's identity.
    expect(describeTccRoot(DECOY_DIR, 'cli').grant).toBe('none')
  })

  it('reports a suspended marker as suspended, not as ungranted', () => {
    suspendTccGrant(DECOY_DIR, 'desktop', 'EPERM')
    expect(describeTccRoot(DECOY_DIR, 'desktop').grant).toBe('suspended')
    expect(describeTccRoot(DECOY_DIR, 'cli').grant).toBe('none')
  })

  it('a grant covers every root under the same anchor', () => {
    const sibling = join(DOCUMENTS, 'other-skills')
    recordTccGrant(DECOY_DIR, 'desktop')
    // TCC scopes consent per protected folder, so the marker is keyed on the
    // anchor and a sibling inside it is already covered.
    expect(describeTccRoot(sibling, 'desktop').grant).toBe('active')
  })

  it('never reads the directory it describes', async () => {
    // A readdir here is exactly what raises the macOS dialog. Point it at a
    // directory whose read would fail and confirm it still answers.
    const sealed = join(DOCUMENTS, 'sealed')
    await mkdir(sealed, { recursive: true })
    await chmod(sealed, 0o000)
    try {
      const got = describeTccRoot(sealed, 'desktop')
      expect(got.protected).toBe(true)
      expect(got.grant).toBe('none')
    } finally {
      await chmod(sealed, 0o700)
    }
  })

  // TCC is a macOS mechanism. A Linux or Windows box has Documents/Desktop/
  // Downloads folders with no consent gate, so reporting them as protected
  // would put a needs-access row in front of someone who can never act on it.
  // Only assertable where the platform itself is not darwin.
  it.skipIf(process.platform === 'darwin')('is inert off macOS', () => {
    delete process.env['SKILLET_TCC_POLICY']
    expect(describeTccRoot(DECOY_DIR, 'desktop')).toEqual({
      protected: false,
      grant: 'none',
      anchor: null,
    })
  })
})
