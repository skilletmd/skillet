import type { Command } from 'commander'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtimeLabel } from '@skillet/core'
import {
  ADDITIONAL_ADAPTERS,
  BASELINE_GLOBAL_ADAPTERS,
  BASELINE_READER_ADAPTERS,
} from '../cli-context.js'
import { inlinedRouteSkillMd } from '../bundled-route-content.js'
import { resolveBundledRouteSkillDir } from '../bundled-route-path.js'

// Cursor reads the global ~/.agents/skills baseline rather than its own dir
// (mirrors the runtimes command).
const GLOBAL_AGENTS_SKILLS = new Set(['cursor'])

/** The bundled router SKILL.md, from the pkg-inlined copy or the on-disk source. */
async function routeSkillMd(): Promise<string> {
  const inlined = inlinedRouteSkillMd()
  if (inlined) return inlined
  return readFile(join(resolveBundledRouteSkillDir(), 'SKILL.md'), 'utf8')
}

/** Detected runtimes and where their skills live (same detection as `agents`). */
async function detectRuntimeTargets(): Promise<Array<{ label: string; targetDir: string }>> {
  const agentsSkills = join(homedir(), '.agents', 'skills')
  const seen = new Set<string>()
  const out: Array<{ label: string; targetDir: string }> = []
  for (const adapter of [...BASELINE_GLOBAL_ADAPTERS, ...ADDITIONAL_ADAPTERS]) {
    if (seen.has(adapter.name)) continue
    try {
      if (await adapter.detect()) {
        seen.add(adapter.name)
        const label =
          adapter.name === 'codex' && existsSync(join(homedir(), '.codex'))
            ? 'Codex'
            : runtimeLabel(adapter.name)
        out.push({
          label,
          targetDir: GLOBAL_AGENTS_SKILLS.has(adapter.name) ? agentsSkills : adapter.targetDir,
        })
      }
    } catch {
      // Non-fatal: skip adapters whose detect() throws.
    }
  }
  for (const adapter of BASELINE_READER_ADAPTERS) {
    if (seen.has(adapter.name)) continue
    try {
      if (await adapter.detect()) {
        seen.add(adapter.name)
        out.push({ label: runtimeLabel(adapter.name), targetDir: agentsSkills })
      }
    } catch {
      // Non-fatal.
    }
  }
  return out
}

export interface RouterInstallResult {
  /** Runtime labels the skill was written for (may repeat when runtimes share a dir). */
  labels: string[]
}

/**
 * Install the bundled `/skillet` router skill into every detected agent runtime.
 * No account, pairing, sync, or network. Returns the labels written to (empty when
 * no runtime is detected). Shared by `skillet init` and the cold-start front door
 * in index.ts, so the one-command install and the bare-invocation install never
 * drift.
 */
export async function installRouterSkill(): Promise<RouterInstallResult> {
  const md = await routeSkillMd()
  const targets = await detectRuntimeTargets()
  // Dedup by target dir: several runtimes can share ~/.agents/skills.
  const written = new Set<string>()
  const labels: string[] = []
  for (const t of targets) {
    const dir = join(t.targetDir, 'skillet')
    if (!written.has(dir)) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), md, 'utf8')
      written.add(dir)
    }
    labels.push(t.label)
  }
  return { labels }
}

/**
 * `skillet init` — install the `/skillet` router skill into every detected agent,
 * with NO account, pairing, or sync. This is the Summon tier's front door: once
 * the router skill is present, `/skillet @<handle> <task>` summons anyone's public
 * kit live from the registry. `--print` emits the skill for a manual copy-paste
 * install on hosts the detector misses.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Install the /skillet router skill into your agents. No account needed')
    .option('--print', 'Print the router skill instead of installing it (copy-paste fallback)')
    .action(async (opts: { print?: boolean }) => {
      if (opts.print === true) {
        const md = await routeSkillMd()
        process.stdout.write(md.endsWith('\n') ? md : md + '\n')
        return
      }
      const { labels } = await installRouterSkill()
      if (labels.length === 0) {
        console.log(
          'No agents detected on this machine. Run `skillet init --print` to copy the skill in yourself.',
        )
        return
      }
      console.log(`Installed /skillet into ${labels.join(', ')}.`)
      console.log('Try it: /skillet @<handle> <task>  (for example, /skillet @taylor write me a blog)')
    })
}
