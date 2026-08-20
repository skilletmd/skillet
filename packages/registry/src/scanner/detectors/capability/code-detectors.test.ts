import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DecodedBundle } from '@skillet/protocol';
import { CODE_CAPABILITY_DETECTORS } from './code-detectors.js';
import { runCapabilityScan } from '../../capabilities/collector.js';
import type { Capability } from '../../capabilities/types.js';

const enc = new TextEncoder();

type Hit = { capability: Capability; lineStart: number; lineEnd: number };

/** Run every code detector over one (file, contents) and collect raw hits. */
function detect(file: string, contents: string): Hit[] {
  const out: Hit[] = [];
  for (const d of CODE_CAPABILITY_DETECTORS) out.push(...d(file, contents));
  return out;
}

function caps(file: string, contents: string): Set<Capability> {
  return new Set(detect(file, contents).map((h) => h.capability));
}

function bundle(files: Record<string, string>): DecodedBundle {
  return new Map(Object.entries(files).map(([p, t]) => [p, enc.encode(t)]));
}

describe('code capability detectors — runs-shell', () => {
  it('detects benign subprocess.run (Python) as runs-shell', () => {
    // AE1 detection half — benign; the risky flag is the collector's join.
    assert.ok(caps('s.py', 'subprocess.run(["ls"])\n').has('runs-shell'));
  });

  it('detects child_process.execSync (JS) as runs-shell', () => {
    const src = "import { execSync } from 'child_process';\nexecSync('ls');\n";
    assert.ok(caps('s.js', src).has('runs-shell'));
  });

  it('detects os.system (Python) as runs-shell', () => {
    assert.ok(caps('s.py', 'import os\nos.system("ls")\n').has('runs-shell'));
  });

  it('flags a shell script (shebang) as runs-shell', () => {
    assert.ok(caps('run.sh', '#!/bin/bash\nls -la\n').has('runs-shell'));
  });

  it('does NOT flag RegExp.exec as runs-shell (binding resolution)', () => {
    const src = 'const re = /foo/;\nconst m = re.exec("foobar");\n';
    assert.ok(!caps('s.js', src).has('runs-shell'));
  });

  it('does NOT flag sqlite db.exec(...) as runs-shell (binding resolution)', () => {
    const src = "const db = require('better-sqlite3')('x.db');\ndb.exec('CREATE TABLE t(x)');\n";
    assert.ok(!caps('s.js', src).has('runs-shell'));
  });
});

describe('code capability detectors — network', () => {
  it('detects fetch() in JS', () => {
    assert.ok(caps('s.js', 'await fetch("https://x")\n').has('network'));
  });

  it('detects requests.get in Python', () => {
    assert.ok(caps('s.py', 'import requests\nrequests.get("https://x")\n').has('network'));
  });

  it('detects curl in a shell script', () => {
    assert.ok(caps('run.sh', '#!/bin/sh\ncurl https://x\n').has('network'));
  });

  it('does NOT flag a `.fetch(` method (binding/RPC/test harness, not the internet)', () => {
    assert.ok(!caps('s.ts', 'const r = await worker.fetch(req)\n').has('network'));
    assert.ok(!caps('s.ts', "const r = await env.ASSETS.fetch(new Request('/x'))\n").has('network'));
    // Bare global fetch still counts.
    assert.ok(caps('s.ts', 'const r = await fetch("https://x")\n').has('network'));
  });
});

describe('code capability detectors — reads-secrets', () => {
  it('detects process.env access in JS', () => {
    assert.ok(caps('s.js', 'const t = process.env.TOKEN\n').has('reads-secrets'));
  });

  it('detects os.environ access in Python', () => {
    assert.ok(caps('s.py', 'import os\nt = os.environ["TOKEN"]\n').has('reads-secrets'));
  });

  it('detects os.getenv in Python', () => {
    assert.ok(caps('s.py', 'import os\nt = os.getenv("TOKEN")\n').has('reads-secrets'));
  });

  it('detects a real .env READ in shell (source/cat/dot-source/redirect)', () => {
    assert.ok(caps('s.sh', '#!/bin/sh\nsource .env\n').has('reads-secrets'));
    assert.ok(caps('s.sh', '#!/bin/sh\ncat config/.env\n').has('reads-secrets'));
    assert.ok(caps('s.sh', '#!/bin/sh\n. ./.env\n').has('reads-secrets'));
  });

  it('does NOT flag a .env EXCLUDE / mention as reads-secrets (v4)', () => {
    // rsync/tar exclude keeps secrets OUT of the bundle — the opposite of a read.
    assert.ok(!caps('s.sh', "#!/bin/sh\ntar --exclude='.env' --exclude='.env.*' -czf b.tgz .\n").has('reads-secrets'));
    assert.ok(!caps('s.sh', "#!/bin/sh\nrsync --exclude='.env' src/ dst/\n").has('reads-secrets'));
  });
});

describe('code capability detectors — writes-files', () => {
  it('detects fs.writeFileSync in JS', () => {
    assert.ok(caps('s.js', 'fs.writeFileSync("f", data)\n').has('writes-files'));
  });

  it('detects open(path, "w") in Python', () => {
    assert.ok(caps('s.py', 'open("f", "w").write("x")\n').has('writes-files'));
  });

  it('does NOT count open(path, "rb") in Python', () => {
    assert.ok(!caps('s.py', 'open("f", "rb").read()\n').has('writes-files'));
  });

  it('detects > redirection in a shell script', () => {
    assert.ok(caps('run.sh', '#!/bin/sh\necho x > f\n').has('writes-files'));
  });

  it('does NOT count 2>&1 as a file write', () => {
    assert.ok(!caps('run.sh', '#!/bin/sh\nfoo 2>&1\n').has('writes-files'));
  });
});

describe('code capability detectors — deletes-files', () => {
  it('detects fs.unlinkSync in JS', () => {
    assert.ok(caps('s.js', 'fs.unlinkSync("f")\n').has('deletes-files'));
  });

  it('detects os.remove in Python', () => {
    assert.ok(caps('s.py', 'import os\nos.remove("f")\n').has('deletes-files'));
  });

  it('detects shutil.rmtree in Python', () => {
    assert.ok(caps('s.py', 'import shutil\nshutil.rmtree("d")\n').has('deletes-files'));
  });

  it('detects rm -f in a shell script', () => {
    assert.ok(caps('run.sh', '#!/bin/sh\nrm -f f\n').has('deletes-files'));
  });

  it('detects shred as deletes-files (AE2 detection half)', () => {
    // The risky flag is the collector join; the detector only inventories usage.
    assert.ok(caps('wipe.sh', '#!/bin/sh\nshred -n 3 /dev/sda\n').has('deletes-files'));
  });
});

describe('code capability detectors — Swift', () => {
  // Swift was read and threat-scanned all along, but carried no capability
  // detector, so every `.swift` / `.swift.template` file in an iOS skill counted
  // as an unscanned blind spot. These are the shapes that earn each chip.
  it('flags Process() and NSTask as runs-shell', () => {
    assert.ok(caps('tool.swift', 'let p = Process()\np.launchPath = "/bin/ls"\n').has('runs-shell'));
    assert.ok(caps('tool.swift', 'let t = NSTask()\n').has('runs-shell'));
  });

  it('flags URLSession as network but leaves a plain URL value alone', () => {
    assert.ok(caps('net.swift', 'URLSession.shared.dataTask(with: req)\n').has('network'));
    // A file URL is not the internet; skills build these constantly.
    assert.ok(!caps('net.swift', 'let u = URL(fileURLWithPath: "/tmp/x")\n').has('network'));
  });

  it('flags write(to:) / createFile as writes-files and removeItem as deletes-files', () => {
    assert.ok(caps('io.swift', 'try data.write(to: url)\n').has('writes-files'));
    assert.ok(caps('io.swift', 'FileManager.default.createFile(atPath: p, contents: d)\n').has('writes-files'));
    assert.ok(caps('io.swift', 'try FileManager.default.removeItem(at: url)\n').has('deletes-files'));
  });

  it('flags environment and Keychain reads as reads-secrets', () => {
    assert.ok(caps('env.swift', 'let t = ProcessInfo.processInfo.environment["TOKEN"]\n').has('reads-secrets'));
    assert.ok(caps('env.swift', 'SecItemCopyMatching(query as CFDictionary, &item)\n').has('reads-secrets'));
  });

  it('covers a .swift.template the same as the .swift it generates', () => {
    // extOf strips the template suffix, so scaffolding is classified by its
    // inner extension rather than parked as an unreadable blind spot.
    assert.ok(caps('templates/StateServer.swift.template', 'let p = Process()\n').has('runs-shell'));
  });

  it('leaves inert Swift with no capability at all', () => {
    assert.equal(caps('model.swift', 'struct User {\n  let name: String\n}\n').size, 0);
  });
});

describe('code capability detectors — executes-generated', () => {
  it('detects eval(x) in JS', () => {
    assert.ok(caps('s.js', 'eval(userInput)\n').has('executes-generated'));
  });

  it('detects new Function(...) in JS', () => {
    assert.ok(caps('s.js', 'const f = new Function("return 1")\n').has('executes-generated'));
  });

  it('detects exec(src) in Python', () => {
    assert.ok(caps('s.py', 'exec(src)\n').has('executes-generated'));
  });

  it('detects bare compile(src) in Python', () => {
    assert.ok(caps('s.py', 'code = compile(src, "<s>", "exec")\n').has('executes-generated'));
  });

  it('does NOT count re.compile as executes-generated', () => {
    assert.ok(!caps('s.py', 'import re\np = re.compile("x")\n').has('executes-generated'));
  });
});

describe('code capability detectors — reads-secrets ReDoS guard', () => {
  it('detects secret-shaped env expansions in a shell script', () => {
    assert.ok(caps('s.sh', 'echo $API_TOKEN\n').has('reads-secrets'));
    assert.ok(caps('s.sh', 'echo ${DB_PASSWORD}\n').has('reads-secrets'));
  });

  it('returns promptly on a pathological all-letters input (no catastrophic backtracking)', () => {
    // A long run of letters with no credential keyword is the worst case for the
    // old adjacent-unbounded-quantifier regex (O(n^2)). The bounded runs make it
    // linear; this must finish well under a second.
    const pathological = 's.sh shebang\n' + 'A'.repeat(500_000) + '\n';
    const start = Date.now();
    caps('s.sh', pathological);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `secrets regex took ${elapsed}ms — expected < 1000ms`);
  });
});

describe('code capability detectors — PY_WRITES ReDoS guard', () => {
  it('still detects open(path, "w") / "a" / "x" modes', () => {
    assert.ok(caps('s.py', 'open("f", "w").write("x")\n').has('writes-files'));
    assert.ok(caps('s.py', 'open("f", "a")\n').has('writes-files'));
    assert.ok(caps('s.py', 'open("f", "xb")\n').has('writes-files'));
  });

  it('still ignores read modes', () => {
    assert.ok(!caps('s.py', 'open("f", "rb").read()\n').has('writes-files'));
    assert.ok(!caps('s.py', 'open("f", "r")\n').has('writes-files'));
  });

  it('returns promptly on an unterminated quoted mode (no O(n^2) backtracking)', () => {
    // The old `[^'"]*[wax][^'"]*` flanking pair was quadratic on a long string
    // with no closing quote (the prompt's `open(x,"` + ~200k chars case).
    const pathological = 'open(x,"' + 'a'.repeat(200_000); // no closing quote/paren
    const start = Date.now();
    caps('s.py', pathological);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `PY_WRITES took ${elapsed}ms — expected < 1000ms`);
  });

  it('returns promptly on a repeated open( prefix with no terminator (bounded [^)] run)', () => {
    // A repeated `open(` token with no `)` made the unbounded `[^)]*` prefix
    // itself quadratic (O(occurrences * n)); the {0,256} bound keeps it linear.
    const pathological = 'open('.repeat(40_000); // 200k chars, ~40k open( starts
    const start = Date.now();
    caps('s.py', pathological);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `PY_WRITES (repeated open() took ${elapsed}ms — expected < 1000ms`);
  });
});

describe('code capability detectors — install-hooks', () => {
  it('detects a postinstall lifecycle script in package.json', () => {
    const pkg = '{\n  "name": "x",\n  "scripts": {\n    "postinstall": "node setup.js"\n  }\n}\n';
    assert.ok(caps('package.json', pkg).has('install-hooks'));
  });

  it('does NOT flag lifecycle key names in a non-manifest script', () => {
    assert.ok(!caps('s.js', 'const postinstall = true\n').has('install-hooks'));
  });
});

describe('code capability detectors — gating + line accuracy', () => {
  it('returns no code capabilities for a markdown (prose) file (U3 surface)', () => {
    const md = 'Run `subprocess.run(["ls"])` and `curl https://x`\n';
    assert.equal(caps('SKILL.md', md).size, 0);
  });

  it('reports an accurate lineStart for a hit', () => {
    const src = 'import os\n\n\nos.system("ls")\n'; // os.system on line 4
    const hit = detect('s.py', src).find((h) => h.capability === 'runs-shell');
    assert.ok(hit);
    assert.equal(hit.lineStart, 4);
  });
});

describe('code capability detectors — integration via runCapabilityScan', () => {
  it('produces a multi-capability report wired into the collector', () => {
    const b = bundle({
      'fetch.js': 'await fetch("https://x")\n',
      'wipe.sh': '#!/bin/sh\nshred -n 3 /dev/sda\n',
      'env.py': 'import os\nt = os.environ["TOKEN"]\n',
    });
    const report = runCapabilityScan(b, CODE_CAPABILITY_DETECTORS);
    const present = new Set(report.capabilities.map((c) => c.capability));
    assert.ok(present.has('network'));
    assert.ok(present.has('deletes-files'));
    assert.ok(present.has('reads-secrets'));
    // benign vs risky is NOT distinguished here — all benign without findings.
    assert.ok(report.capabilities.every((c) => c.risky === false));
  });

  it('joins a co-located threat finding to mark the capability risky (AE2)', () => {
    const b = bundle({ 'wipe.sh': '#!/bin/sh\nshred -n 3 /dev/sda\n' });
    const report = runCapabilityScan(b, CODE_CAPABILITY_DETECTORS, [
      { file: 'wipe.sh', lineStart: 2, lineEnd: 2 },
    ]);
    const del = report.capabilities.find((c) => c.capability === 'deletes-files');
    assert.ok(del);
    assert.equal(del.risky, true);
  });
});
