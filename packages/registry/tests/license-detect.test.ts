// Per-skill license detection: basename allowlist + exclusions, own→ancestor→root
// precedence (never sibling), and text/filename SPDX resolution. Cases seeded from
// the 582-repo audit (anthropics/skills subfolder shape; aiskillstore sibling trap;
// LICENSEZone.Identifier / license_checker.py false positives).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLicenseFile,
  effectiveLicensePath,
  detectSpdxFromText,
  resolveSpdx,
  isPermissiveSpdx,
} from '../src/lib/license-detect.js'

describe('isLicenseFile', () => {
  it('accepts real license basenames', () => {
    for (const p of [
      'LICENSE',
      'LICENSE.txt',
      'LICENSE.md',
      'LICENSE.TXT',
      'license',
      'COPYING',
      'UNLICENSE',
      'LICENSE-MIT',
      'LICENSE-APACHE',
      'skills/pptx/LICENSE.txt',
    ]) {
      assert.equal(isLicenseFile(p), true, p)
    }
  })

  it('rejects false positives from the audit', () => {
    for (const p of [
      'LICENSEZone.Identifier',
      'license_checker.py',
      'license_compatibility_matrix.md',
      'license.json',
      'some/licenses/foo.md', // dependency license bundle dir
      'third_party/x/BUILD.gn',
      'node_modules/pkg/LICENSE',
      'README.md',
    ]) {
      assert.equal(isLicenseFile(p), false, p)
    }
  })
})

describe('effectiveLicensePath — precedence', () => {
  it('own folder wins over root', () => {
    const paths = ['LICENSE', 'skills/pptx/LICENSE.txt', 'skills/pptx/SKILL.md']
    assert.equal(effectiveLicensePath('skills/pptx', paths), 'skills/pptx/LICENSE.txt')
  })

  it('ancestor applies when the skill dir has none', () => {
    const paths = ['skills/LICENSE', 'skills/pptx/SKILL.md']
    assert.equal(effectiveLicensePath('skills/pptx', paths), 'skills/LICENSE')
  })

  it('root applies to a subdir skill with no closer license', () => {
    const paths = ['LICENSE', 'skills/pptx/SKILL.md']
    assert.equal(effectiveLicensePath('skills/pptx', paths), 'LICENSE')
  })

  it('never inherits a sibling license (the aggregator trap)', () => {
    const paths = ['skills/foo/LICENSE', 'skills/bar/SKILL.md']
    assert.equal(effectiveLicensePath('skills/bar', paths), null)
  })

  it('returns null when no license exists anywhere', () => {
    assert.equal(effectiveLicensePath('skills/pptx', ['skills/pptx/SKILL.md']), null)
  })

  it('root skill (dir "") finds a root license', () => {
    assert.equal(effectiveLicensePath('', ['LICENSE', 'SKILL.md']), 'LICENSE')
  })
})

describe('detectSpdxFromText', () => {
  it('classifies permissive licenses', () => {
    assert.equal(detectSpdxFromText('Apache License\nVersion 2.0, January 2004'), 'Apache-2.0')
    assert.equal(
      detectSpdxFromText('MIT License\n\nPermission is hereby granted, free of charge, to any person'),
      'MIT',
    )
    assert.equal(
      detectSpdxFromText('Redistribution and use in source and binary forms ... Neither the name of'),
      'BSD-3-Clause',
    )
    assert.equal(
      detectSpdxFromText('Redistribution and use in source and binary forms, with or without'),
      'BSD-2-Clause',
    )
  })

  it('classifies copyleft (so callers can reject it)', () => {
    assert.equal(detectSpdxFromText('GNU AFFERO GENERAL PUBLIC LICENSE Version 3'), 'AGPL-3.0-only')
    assert.equal(detectSpdxFromText('GNU GENERAL PUBLIC LICENSE Version 3'), 'GPL-3.0-only')
  })

  it('returns null on unrecognized text', () => {
    assert.equal(detectSpdxFromText('this is just a readme'), null)
  })
})

describe('resolveSpdx', () => {
  it('reads a subfolder LICENSE from content (the anthropics/skills case)', () => {
    const spdx = resolveSpdx({
      licensePath: 'skills/pptx/LICENSE.txt',
      content: 'Apache License\nVersion 2.0',
      repoRootSpdx: null,
    })
    assert.equal(spdx, 'Apache-2.0')
    assert.equal(isPermissiveSpdx(spdx), true)
  })

  it('uses filename hint for a dual-license file', () => {
    assert.equal(resolveSpdx({ licensePath: 'LICENSE-APACHE' }), 'Apache-2.0')
  })

  it('falls back to the repo SPDX for a root license', () => {
    assert.equal(resolveSpdx({ licensePath: 'LICENSE', repoRootSpdx: 'MIT' }), 'MIT')
  })

  it('returns null (non-permissive) when undetermined', () => {
    assert.equal(resolveSpdx({ licensePath: 'skills/x/LICENSE', content: 'weird text' }), null)
    assert.equal(isPermissiveSpdx(null), false)
  })
})
