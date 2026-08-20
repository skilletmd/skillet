/**
 * collectDoctorReport — diagnostic snapshot for `skillet doctor`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalContentHash } from '@skillet/protocol';

describe('collectDoctorReport', () => {
  let skilletDir: string;
  const prevDir = process.env['SKILLET_DIR'];
  const prevToken = process.env['SKILLET_TOKEN'];
  const prevForce = process.env['SKILLET_TOKEN_FORCE'];

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = await mkdtemp(join(tmpdir(), 'skillet-doctor-'));
    process.env['SKILLET_DIR'] = skilletDir;
    delete process.env['SKILLET_TOKEN'];
    delete process.env['SKILLET_TOKEN_FORCE'];
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env['SKILLET_DIR'];
    else process.env['SKILLET_DIR'] = prevDir;
    if (prevToken === undefined) delete process.env['SKILLET_TOKEN'];
    else process.env['SKILLET_TOKEN'] = prevToken;
    if (prevForce === undefined) delete process.env['SKILLET_TOKEN_FORCE'];
    else process.env['SKILLET_TOKEN_FORCE'] = prevForce;
    await rm(skilletDir, { recursive: true, force: true });
  });

  it('returns doctor_report/v1 with bearer, pending, and state counts', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-doctor',
        label: 'Doctor Laptop',
      }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'state.json'),
      JSON.stringify({
        version: 1,
        edited_reported: true,
        skills: {},
      }),
      'utf8',
    );

    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          handle: 'thiago',
          user_id: 'user-abc',
          device_id: 'dev-doctor',
          scopes: ['publish'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const { collectDoctorReport, DOCTOR_REPORT_SCHEMA } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({
      registryUrl: 'https://registry.example',
      fetchImpl,
      adapters: [],
    });

    expect(report.schema).toBe(DOCTOR_REPORT_SCHEMA);
    expect(report.auth.bearer.kind).toBe('device');
    expect(report.auth.whoami?.handle).toBe('thiago');
    expect(report.state.skill_count).toBe(0);
    expect(report.state.edited_reported).toBe(true);
    expect(report.pending.count).toBe(0);
    expect(report.device.device_id).toBe('dev-doctor');
    expect(report.device.label).toBe('Doctor Laptop');
    expect(report.env.skillet_token_set).toBe(false);
  });

  it('includes connect hints when no credentials are present', async () => {
    const { collectDoctorReport } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({ adapters: [] });

    expect(report.auth.bearer.kind).toBe('none');
    expect(report.state.skill_count).toBe(0);
    expect(report.pending.count).toBe(0);
    expect(report.auth.hints.some((h) => h.includes('skillet connect'))).toBe(true);
    expect(report.env.session_token_precedence).toBe('none');
  });

  it('reports env_forced precedence when SKILLET_TOKEN_FORCE is set', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_fromfile', saved_at: new Date().toISOString() }),
      'utf8',
    );
    process.env['SKILLET_TOKEN'] = 'skillet_k_cikey';
    process.env['SKILLET_TOKEN_FORCE'] = '1';

    const { collectDoctorReport } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({ adapters: [] });

    expect(report.env.session_token_precedence).toBe('env_forced');
    expect(report.env.skillet_token_set).toBe(true);
    expect(report.env.skillet_token_force).toBe(true);
  });

  it('keeps file precedence when env token is set without force', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_fromfile', saved_at: new Date().toISOString() }),
      'utf8',
    );
    process.env['SKILLET_TOKEN'] = 'skillet_k_cikey';

    const { collectDoctorReport } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({ adapters: [] });

    expect(report.env.session_token_precedence).toBe('file');
  });

  it('reports store_drift when registry entry hash disagrees with skill store bytes', async () => {
    const { redirectHome } = await import('./helpers/redirect-home.cjs');
    const home = redirectHome('skillet-doctor-drift');
    process.env['SKILLET_DIR'] = join(home, '.skillet');
    await mkdir(join(home, '.skillet'), { recursive: true });

    const alignedHash = 'sha256:' + 'aa'.repeat(32);
    const driftedBytes = Buffer.from(
      '---\nname: drift-skill\ndescription: x\n---\ndrifted bytes\n',
      'utf8',
    );
    const driftedHash = canonicalContentHash(new Map([['SKILL.md', driftedBytes]]));
    await writeFile(
      join(home, '.skillet', 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@alice/drift-skill': {
            slug: '@alice/drift-skill',
            owner: 'alice',
            name: 'drift-skill',
            description: '',
            version: 1,
            hash: alignedHash,
            source: 'registry',
            registryUrl: 'https://registry.example',
            importedAt: '2026-07-06T00:00:00Z',
            updatedAt: '2026-07-06T00:00:00Z',
          },
        },
      }),
      'utf8',
    );

    const skillDir = join(home, '.skillet', 'skills', '@alice', 'drift-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), driftedBytes);

    const { collectDoctorReport } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({ adapters: [] });

    expect(report.store_drift).toHaveLength(1);
    expect(report.store_drift[0]?.slug).toBe('@alice/drift-skill');
    expect(report.store_drift[0]?.entry_hash).toBe(alignedHash);
    expect(report.store_drift[0]?.store_hash).toBe(driftedHash);
  });

  it('reports cursor_description_synthesis for kit-synced skills without frontmatter description', async () => {
    const { redirectHome } = await import('./helpers/redirect-home.cjs');
    const home = redirectHome('skillet-doctor-cursor-desc');
    process.env['SKILLET_DIR'] = join(home, '.skillet');
    await mkdir(join(home, '.skillet'), { recursive: true });

    await writeFile(
      join(home, '.skillet', 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@thiago/bob-edited': {
            slug: '@thiago/bob-edited',
            owner: 'thiago',
            name: 'bob-edited',
            description: '',
            version: 1,
            hash: 'sha256:' + 'bb'.repeat(32),
            source: 'local',
            sourceKit: '@thiago/profile',
            importedAt: '2026-07-07T00:00:00Z',
            updatedAt: '2026-07-07T00:00:00Z',
          },
        },
      }),
      'utf8',
    );

    const skillDir = join(home, '.skillet', 'skills', '@thiago', 'bob-edited');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# edited by the user locally\n', 'utf8');

    const { collectDoctorReport } = await import('../src/commands/doctor.js');
    const report = await collectDoctorReport({ adapters: [] });

    expect(report.cursor_description_synthesis).toHaveLength(1);
    expect(report.cursor_description_synthesis[0]?.slug).toBe('@thiago/bob-edited');
    expect(report.cursor_description_synthesis[0]?.source).toBe('body');
    expect(report.cursor_description_synthesis[0]?.resolved_description).toBe(
      'edited by the user locally',
    );
  });

  it('reports store_missing for state skills whose store directory is absent', async () => {
    await mkdir(skilletDir, { recursive: true })

    const now = new Date().toISOString()
    await writeFile(
      join(skilletDir, 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'good-import': {
            slug: 'good-import',
            name: 'good-import',
            description: '',
            version: 1,
            hash: 'sha256:' + '0'.repeat(64),
            source: 'registry',
            sourceClass: 'external',
            authorKeyId: 'a'.repeat(64),
            importedAt: now,
            updatedAt: now,
          },
        },
      }),
      'utf8',
    )

    const { collectDoctorReport } = await import('../src/commands/doctor.js')
    const report = await collectDoctorReport({ adapters: [] })

    expect(report.store_missing).toHaveLength(1)
    expect(report.store_missing[0]?.slug).toBe('good-import')
  })
});
