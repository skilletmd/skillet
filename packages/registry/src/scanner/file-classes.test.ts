import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMarkdownFile,
  isScriptFile,
  isShebangScript,
  isCoveredByDetector,
  isInertShape,
  isTextExtension,
  extOf,
  shebangInterpreterExt,
  effectiveScriptPath,
} from './file-classes.js';

describe('file-classes — extOf', () => {
  it('returns the lowercased extension with the dot', () => {
    assert.equal(extOf('a/b/c.MD'), '.md');
    assert.equal(extOf('x.tar.gz'), '.gz');
  });
  it('returns empty for no-extension and dotfiles', () => {
    assert.equal(extOf('Dockerfile'), '');
    assert.equal(extOf('.npmrc'), '');
  });
});

describe('file-classes — template suffixes are transparent', () => {
  it('classifies by the inner extension: a template OF markdown is markdown', () => {
    assert.equal(extOf('SKILL.md.tmpl'), '.md');
    assert.equal(extOf('conf/nginx.conf.template'), '.conf');
    assert.equal(extOf('run.sh.TPL'), '.sh');
    assert.equal(isMarkdownFile('SKILL.md.tmpl'), true);
    assert.equal(isCoveredByDetector('SKILL.md.tmpl'), true);
    assert.equal(isScriptFile('install.sh.tmpl'), true);
    assert.equal(isInertShape('config.yaml.template'), true);
    assert.equal(isTextExtension('SKILL.md.tmpl'), true);
  });

  it('a bare template with no inner extension stays an unknown shape (blind spot)', () => {
    assert.equal(extOf('foo.tmpl'), '');
    assert.equal(isCoveredByDetector('foo.tmpl'), false);
    assert.equal(isInertShape('foo.tmpl'), false);
  });
});

describe('file-classes — predicates match the legacy taxonomy', () => {
  it('isMarkdownFile: the full markdown family', () => {
    for (const p of ['SKILL.md', 'doc.mdx', 'rules/workers.mdc', 'notes.markdown']) {
      assert.equal(isMarkdownFile(p), true, p);
    }
    assert.equal(isMarkdownFile('tool.ts'), false);
  });

  it('isScriptFile: scripts/source true, markdown/docs false', () => {
    for (const p of ['run.sh', 'a.py', 'b.ts', 'c.rb', 'd.go', 'e.cpp']) {
      assert.equal(isScriptFile(p), true, p);
    }
    for (const p of ['README.md', 'data.json', 'logo.png']) {
      assert.equal(isScriptFile(p), false, p);
    }
  });

  it('isShebangScript: extensionless shebang bin paths only', () => {
    assert.equal(isShebangScript('bin/install', '#!/bin/bash\n'), true);
    assert.equal(isShebangScript('references/foo', 'plain prose\n'), false);
    assert.equal(isShebangScript('run.sh', '#!/bin/bash\n'), false);
  });

  it('isCoveredByDetector: capability code + manifests + the markdown family', () => {
    for (const p of ['a.ts', 'a.mts', 'b.py', 'c.sh', 'package.json', 'x.md', 'x.mdx', 'rules/workers.mdc', 'notes.markdown']) {
      assert.equal(isCoveredByDetector(p), true, p);
    }
    // Not covered: unsupported languages, unknown shapes.
    for (const p of ['setup.rb', 'main.go', 'thing.xyz']) {
      assert.equal(isCoveredByDetector(p), false, p);
    }
  });

  it('isInertShape: data/doc/media + fixed names', () => {
    for (const p of ['data.json', 'config.yaml', 'logo.svg', 'icon.png', 'deps.lock', 'LICENSE', 'README', 'notes.markdown']) {
      assert.equal(isInertShape(p), true, p);
    }
    for (const p of ['run.sh', 'setup.rb', 'rules/workers.mdc', 'thing.xyz']) {
      assert.equal(isInertShape(p), false, p);
    }
  });

  it('isTextExtension: allowlist + basenames', () => {
    for (const p of ['a.md', 'b.ts', 'c.json', 'Dockerfile', 'LICENSE']) {
      assert.equal(isTextExtension(p), true, p);
    }
    assert.equal(isTextExtension('logo.png'), false);
  });
});

describe('file-classes — shebang resolution for extensionless scripts', () => {
  it('shebangInterpreterExt: maps the common interpreters, null for the rest', () => {
    assert.equal(shebangInterpreterExt('#!/usr/bin/env python3\nprint(1)\n'), '.py');
    assert.equal(shebangInterpreterExt('#!/usr/bin/python\n'), '.py');
    assert.equal(shebangInterpreterExt('#!/usr/bin/env bash\n'), '.sh');
    assert.equal(shebangInterpreterExt('#!/bin/sh\n'), '.sh');
    assert.equal(shebangInterpreterExt('#!/usr/bin/env zsh\n'), '.sh');
    assert.equal(shebangInterpreterExt('#!/usr/bin/env node\n'), '.js');
    // `sh` inside `fish`/`bash` must not match on a bare word boundary miss.
    assert.equal(shebangInterpreterExt('#!/usr/bin/env fish\n'), null);
    assert.equal(shebangInterpreterExt('#!/usr/bin/env ruby\n'), null);
    assert.equal(shebangInterpreterExt('not a shebang\n'), null);
  });

  it('effectiveScriptPath: rescues an otherwise-uncovered extensionless script', () => {
    assert.equal(effectiveScriptPath('scripts/pr-snapshot', '#!/usr/bin/env python3\n'), 'scripts/pr-snapshot.py');
    assert.equal(effectiveScriptPath('scripts/check-health', '#!/usr/bin/env bash\n'), 'scripts/check-health.sh');
    assert.equal(effectiveScriptPath('bin/install', '#!/bin/sh\n'), 'bin/install.sh');
  });

  it('effectiveScriptPath: leaves already-covered and unresolvable files unchanged', () => {
    // Already covered by extension / manifest / markdown / instruction path — never re-routed.
    assert.equal(effectiveScriptPath('scripts/deploy.sh', '#!/usr/bin/env bash\n'), 'scripts/deploy.sh');
    assert.equal(effectiveScriptPath('SKILL.md', '#!/usr/bin/env bash\n'), 'SKILL.md');
    assert.equal(effectiveScriptPath('agents/runner', '#!/usr/bin/env bash\n'), 'agents/runner');
    assert.equal(effectiveScriptPath('references/tool', '#!/usr/bin/env python3\n'), 'references/tool');
    // Uncovered but no recognizable interpreter — stays a blind spot, not falsely covered.
    assert.equal(effectiveScriptPath('scripts/thing', '#!/usr/bin/env ruby\n'), 'scripts/thing');
    // Uncovered, no shebang — unchanged.
    assert.equal(effectiveScriptPath('scripts/notes', 'plain text\n'), 'scripts/notes');
  });
});
