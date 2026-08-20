import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_CAPABILITY_DETECTORS } from './config-detectors.js';
import type { Capability } from '../../capabilities/types.js';

const detect = (file: string, contents: string) =>
  CONFIG_CAPABILITY_DETECTORS.flatMap((d) => d(file, contents));
const caps = (file: string, contents: string): Set<Capability> =>
  new Set(detect(file, contents).map((h) => h.capability));

describe('CONFIG_CAPABILITY_DETECTORS — connects-mcp-server', () => {
  it('flags a populated mcpServers map in .mcp.json', () => {
    assert.ok(
      caps('.mcp.json', '{"mcpServers":{"fs":{"command":"npx"}}}').has('connects-mcp-server'),
    );
  });

  it('flags claude_desktop_config.json and .cursor/.vscode mcp configs', () => {
    assert.ok(
      caps('claude_desktop_config.json', '{"mcpServers":{"git":{"command":"uvx"}}}').has(
        'connects-mcp-server',
      ),
    );
    assert.ok(caps('.cursor/mcp.json', '{"mcpServers":{"x":{"url":"http://y"}}}').has('connects-mcp-server'));
    // VS Code mcp.json uses a top-level "servers" key — trusted in a named mcp config.
    assert.ok(caps('.vscode/mcp.json', '{"servers":{"a":{"command":"node"}}}').has('connects-mcp-server'));
  });

  it('flags an mcpServers key in any .json (unambiguous)', () => {
    assert.ok(caps('config.json', '{"mcpServers":{"a":{"command":"node"}}}').has('connects-mcp-server'));
  });

  it('does NOT flag a bare "servers" key outside an mcp config', () => {
    assert.ok(!caps('config.json', '{"servers":{"prod":{"host":"x"}}}').has('connects-mcp-server'));
  });

  it('does NOT flag an empty mcpServers scaffold', () => {
    assert.deepEqual(detect('.mcp.json', '{"mcpServers":{}}'), []);
  });

  it('does NOT flag package.json or non-JSON', () => {
    assert.deepEqual(detect('package.json', '{"name":"x","scripts":{"a":"b"}}'), []);
    assert.deepEqual(detect('SKILL.md', 'we set up mcpServers by hand'), []);
  });

  it('emits a LOCATION only — never a credential value from the config', () => {
    const hits = detect('.mcp.json', '{"mcpServers":{"g":{"env":{"TOKEN":"sk-secret"}}}}');
    assert.equal(hits.length, 1);
    assert.deepEqual(Object.keys(hits[0]).sort(), ['capability', 'lineEnd', 'lineStart']);
    assert.equal(JSON.stringify(hits[0]).includes('sk-secret'), false);
  });
});
