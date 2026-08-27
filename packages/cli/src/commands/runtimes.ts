import type { Command } from 'commander'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describeTccRoot, detectTccInvocation, runtimeLabel } from '@skillet/core'
import type { TccRootDescription } from '@skillet/core'
import {
  ADDITIONAL_ADAPTERS,
  BASELINE_GLOBAL_ADAPTERS,
  BASELINE_READER_ADAPTERS,
} from '../cli-context.js'

// Agents that read the global ~/.agents/skills baseline rather than their own dir
// (Cursor's per-project .cursor/rules adapter is legacy; it loads the global
// baseline too). Point the tray's folder link at where skills actually live.
const GLOBAL_AGENTS_SKILLS = new Set(['cursor'])

/**
 * `skillet runtimes --json` — list the agent runtimes detected on THIS machine and
 * where their skills materialize. Pure LOCAL detection (each adapter's `detect()`),
 * no registry call, no sync — so it succeeds even when the machine is offline,
 * disconnected, or the sync is failing on a bad skill.
 *
 * Covers BOTH the baseline global adapters (Codex → ~/.agents/skills) and the
 * additional detected runtimes (Claude Code, Cursor, …). The desktop tray reads
 * this for the "your agents" facepile + folder list, decoupled from `sync` so a
 * registry hiccup can never blank out which agents you have.
 */
export function registerRuntimesCommand(program: Command): void {
  // `agents` is the user-facing name; `runtimes` stays as a hidden alias with
  // byte-identical output because the desktop tray shells out to
  // `skillet runtimes --json` (src-tauri lib.rs) — the JSON keys, including
  // the `runtimes` array name, are a compat contract, not vocabulary.
  const action = async (opts: { json?: boolean }) => {
      const agentsSkills = join(homedir(), '.agents', 'skills')
      const seen = new Set<string>()
      // Folder access is reported, never probed: describeTccRoot answers from
      // paths and the grant store, so listing your agents can't be the thing
      // that raises the macOS consent dialog. The context is this process's
      // own TCC identity (desktop when the tray spawned us, cli otherwise) —
      // a grant earned under one says nothing about the other.
      const { context } = detectTccInvocation()
      const runtimes: Array<{
        name: string
        label: string
        targetDir: string
        access: TccRootDescription
      }> = []
      // Baseline first (Codex owns the universal dir), then additional runtimes.
      for (const adapter of [...BASELINE_GLOBAL_ADAPTERS, ...ADDITIONAL_ADAPTERS]) {
        if (seen.has(adapter.name)) continue
        try {
          if (await adapter.detect()) {
            seen.add(adapter.name)
            // The codex adapter also claims the universal ~/.agents dir it
            // owns, so its detect() can't prove Codex itself is installed.
            // Label it Codex only on direct evidence (~/.codex), else keep
            // the honest "Universal". Every surface downstream (tray facepile,
            // onboarding chips) inherits this rule.
            const label =
              adapter.name === 'codex' && existsSync(join(homedir(), '.codex'))
                ? 'Codex'
                : runtimeLabel(adapter.name)
            const targetDir = GLOBAL_AGENTS_SKILLS.has(adapter.name)
              ? agentsSkills
              : adapter.targetDir
            runtimes.push({
              name: adapter.name,
              label,
              targetDir,
              access: describeTccRoot(targetDir, context),
            })
          }
        } catch {
          // Non-fatal — skip adapters whose detect() throws.
        }
      }
      // Baseline-reader agents (opencode) read the universal ~/.agents/skills
      // dir instead of materializing their own — surface them as detected
      // runtimes pointing at that shared dir, without adding them to the
      // materializing set. Their detect() is agent-specific (~/.config/opencode).
      for (const adapter of BASELINE_READER_ADAPTERS) {
        if (seen.has(adapter.name)) continue
        try {
          if (await adapter.detect()) {
            seen.add(adapter.name)
            runtimes.push({
              name: adapter.name,
              label: runtimeLabel(adapter.name),
              targetDir: agentsSkills,
              access: describeTccRoot(agentsSkills, context),
            })
          }
        } catch {
          // Non-fatal — skip adapters whose detect() throws.
        }
      }
      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, runtimes }, null, 2) + '\n')
        return
      }
      if (runtimes.length === 0) {
        console.log('No agents detected on this machine.')
        return
      }
      for (const r of runtimes) {
        console.log(`${r.label}  ${r.targetDir}`)
      }
  }

  program
    .command('agents')
    .description('List the agents on this machine and where their skills live')
    .option('--json', 'Emit a machine-readable list of detected agents')
    .action(action)

  program
    .command('runtimes', { hidden: true })
    .description('Hidden alias of `agents` (desktop tray compat)')
    .option('--json', 'Emit a machine-readable list of detected agents')
    .action(action)
}
