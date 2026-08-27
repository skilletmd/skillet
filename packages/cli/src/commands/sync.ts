import type { Command } from 'commander'
import { join } from 'node:path'
import {
  readState,
  sync,
  kitSyncedSkillEntries,
  isSkilletSystemSkill,
  resolveDeviceScopedManifest,
  RegistryError,
  acceptAuthorKeyRotationWithInvalidation,
  fetchServedAuthorKey,
  RegistryClient,
} from '@skillet/core'
import { installRouteHooksWithConsent } from '../route-hooks-consent.js'
import { ExitCode, exitWith } from '../exit-codes.js'
import { requirePaired } from '../auth-required.js'
import { writeJsonError } from '../json-output.js'
import type { SyncDryRunPlan } from '../dry-run.js'
import { renderAdapterLine, REGISTRY_DEFAULT, BASELINE_READER_ADAPTERS } from '../cli-context.js'
import { resolveSyncAdapters } from '../adapter-tiers.js'
import { resolveBundledCreateSkillDir, resolveBundledRouteSkillDir } from '../bundled-route-path.js'
import { inlinedCreateSkillMd, inlinedRouteSkillMd } from '../bundled-route-content.js'
import { webBaseUrl } from '../cli-command-tier.js'
import { ok, fail, dim, yellow } from '../cli-colors.js'
import { renderSyncKitPlan } from '../kit-list-format.js'
import { printRenderedError } from '../render-error.js'
import { printPendingReviewSummary } from '../pending-review-summary.js'
import {
  buildSyncKitsJson,
  kitGroupsForDevice,
  skipReasonsFromSyncResult,
  type SyncKitGroupJson,
} from '../sync-kit-plan.js'
import {
  authorKeyMismatchHandles,
  renderFailedPullLine,
} from '../sync-author-key-hint.js'
import { confirm } from './import-cmd.js'

async function buildSyncDryRunPlan(cwd: string): Promise<SyncDryRunPlan> {
  const state = await readState()
  const manifest = await resolveDeviceScopedManifest({ registryUrl: REGISTRY_DEFAULT })
  const listOpts = manifest.fetched && manifest.items !== undefined
    ? manifest.items
    : undefined
  const groups = kitGroupsForDevice(state, listOpts)
  const kits = buildSyncKitsJson(groups, new Map(), 'planned')
  const synced = kitSyncedSkillEntries(state)
  const { adapters, baselineNames } = await resolveSyncAdapters(cwd)
  const baselineSet = new Set(baselineNames)
  const baselineAdapters = baselineNames
  const detectedAdditionalAdapters: string[] = []
  for (const adapter of adapters) {
    if (!baselineSet.has(adapter.name)) {
      detectedAdditionalAdapters.push(adapter.name)
    }
  }
  return {
    dryRun: true,
    cwd,
    skillCount: synced.length,
    syncedSkillSlugs: synced.map((s) => s.slug),
    kits,
    baselineAdapters,
    detectedAdditionalAdapters,
    detectedAdapters: adapters.map((a) => a.name),
    lockPath: join(cwd, 'skillet.lock'),
  }
}

async function loadDeviceKitGroups(state: Awaited<ReturnType<typeof readState>>) {
  const manifest = await resolveDeviceScopedManifest({ registryUrl: REGISTRY_DEFAULT })
  const items = manifest.fetched && manifest.items !== undefined ? manifest.items : undefined
  return {
    groups: kitGroupsForDevice(state, items),
    offline: !manifest.reached,
  }
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Put your kit into every agent on this machine')
    .option('--cwd <dir>', 'Working directory for skillet.lock', process.cwd())
    .option('--json', 'Emit a machine-readable result report')
    .option(
      '--dry-run',
      'Preview sync targets and detected agents without writing anything',
    )
    .option(
      '--allow-quarantined',
      'Pre-approve quarantined versions in runs without a terminal',
    )
    .option('--check', 'Detect registry changes without writing to agents')
    .option(
      '--background',
      'Mark this run as an automatic background sync. Agent folders that still need macOS folder access stay parked',
    )
    .option(
      '--user-initiated',
      'Mark this run as user-initiated. Skillet may read agent folders that require a macOS folder-access prompt, and remembers the grant',
    )
    .option('--token <token>', 'Bearer token (session, device, or env override)')
    .action(
      async (opts: {
        cwd: string
        json?: boolean
        dryRun?: boolean
        allowQuarantined?: boolean
        check?: boolean
        background?: boolean
        userInitiated?: boolean
        token?: string
      }) => {
        const asJson = opts.json === true

        // TCC initiation (U3): an explicit flag wins; --background beats
        // --user-initiated when both appear (fail closed). Without either,
        // core derives it from the terminal (interactive TTY = user-initiated,
        // anything else = unattended, which never touches parked folders).
        const tccInitiation: 'user' | 'background' | undefined =
          opts.background === true
            ? 'background'
            : opts.userInitiated === true
              ? 'user'
              : undefined

        if (opts.dryRun) {
          const plan = await buildSyncDryRunPlan(opts.cwd)
          if (asJson) {
            process.stdout.write(JSON.stringify({ ok: true, data: plan }, null, 2) + '\n')
          } else {
            console.log('Dry run. No files written.\n')
            const state = await readState()
            const { groups, offline } = await loadDeviceKitGroups(state)
            console.log(
              renderSyncKitPlan(groups, {
                header: 'Kits on this device (dry run)',
                offline,
              }),
            )
            console.log(
              `\n  universal (always): ${plan.baselineAdapters.join(', ') || '(none)'}`,
            )
            console.log(
              `  additional (detected): ${plan.detectedAdditionalAdapters.length > 0 ? plan.detectedAdditionalAdapters.join(', ') : '(none)'}`,
            )
            console.log(`  lock would write: ${plan.lockPath}`)
          }
          return
        }

        try {
          // Pairing is required — unpaired sync does no local materialization.
          // requirePaired writes the auth_required JSON envelope to STDOUT in
          // --json mode (sync --json, sync --check --json): the desktop parses
          // stdout and classifies non-JSON as an approval block and stderr-only
          // failure as offline, so this must stay machine-readable.
          const bearer = await requirePaired(opts.token, { json: asJson })

          const { adapters: syncAdapters, baselineNames } = await resolveSyncAdapters(opts.cwd)

          // Detected baseline-reader runtimes (opencode) — they read the shared
          // `.agents/skills` baseline, so sync attributes availability to them
          // without materializing a second copy.
          const readerRuntimes = (
            await Promise.all(
              BASELINE_READER_ADAPTERS.map(async (a) =>
                (await a.detect().catch(() => false)) ? a.name : null,
              ),
            )
          ).filter((n): n is string => n !== null)

          const syncOpts = {
            allowQuarantined: opts.allowQuarantined === true,
            token: bearer.token || undefined,
            quietSkipLines: !asJson,
            baselineAdapterNames: baselineNames,
            readerRuntimes,
            checkOnly: opts.check === true,
            registryUrl: REGISTRY_DEFAULT,
            bundledRouteSkillDir: resolveBundledRouteSkillDir(),
            bundledRouteSkillMd: inlinedRouteSkillMd(),
            bundledCreateSkillDir: resolveBundledCreateSkillDir(),
            bundledCreateSkillMd: inlinedCreateSkillMd(),
            ...(tccInitiation ? { tccInitiation } : {}),
          }

          let result = await sync(opts.cwd, syncAdapters, syncOpts)

          if (
            !asJson &&
            opts.check !== true &&
            process.stdout.isTTY === true &&
            bearer.token
          ) {
            // Include result.failed: after the first encounter a held
            // key_id_mismatch skill surfaces there (integrity skip), not as a
            // pull outcome — without it the re-pin prompt fires exactly once
            // and a declined or missed prompt strands the skill forever.
            const mismatchHandles = authorKeyMismatchHandles([
              ...result.unionPull,
              ...result.pull,
              ...result.failed.map((f) => ({ slug: f.slug, status: 'failed' as const, reason: f.reason })),
            ])
            let repinned = false
            const client = new RegistryClient({
              baseUrl: REGISTRY_DEFAULT,
              token: bearer.token,
            })
            for (const handle of mismatchHandles) {
              const accepted = await confirm(
                `Author signing key changed for @${handle}. Accept the registry key and retry sync?`,
              )
              if (!accepted) continue
              try {
                const served = await fetchServedAuthorKey(handle, client)
                await acceptAuthorKeyRotationWithInvalidation(handle, {
                  key_id: served.key_id,
                  pub: served.pub,
                })
                repinned = true
              } catch (err) {
                console.error(fail(`Could not re-pin @${handle}: ${(err as Error).message}`))
              }
            }
            if (repinned) {
              result = await sync(opts.cwd, syncAdapters, syncOpts)
            }
          }

          if (opts.check === true) {
            const unionFailed = result.unionPull.filter((o) => o.status === 'failed')
            const pullFailed = result.pull.filter((o) => o.status === 'failed')
            const checkOk = unionFailed.length === 0 && pullFailed.length === 0
            if (asJson) {
              process.stdout.write(
                JSON.stringify(
                  {
                    ok: checkOk,
                    changed: result.changed === true,
                    unionPull: result.unionPull,
                    pull: result.pull,
                    failed: result.failed,
                  },
                  null,
                  2,
                ) + '\n',
              )
            } else if (result.changed) {
              console.log('Changes detected. Apply them with `skillet sync`')
            } else {
              console.log(ok('Up to date.'))
            }
            // exitCode + natural exit, NOT exitWith: process.exit() truncates a
            // pipe-bound stdout at the 64KB buffer, and this envelope can be
            // megabytes when many skills fail. The desktop tray reads it through
            // a pipe; a truncated envelope paints the app "Offline".
            if (!checkOk) process.exitCode = ExitCode.ERROR
            return
          }

          const stateAfter = await readState()
          // Exclude the bundled `/skillet` router — it's Skillet's own plumbing,
          // never a user-visible skill (same as `skillet list`).
          const allSkills = Object.values(stateAfter.skills).filter(
            (e) => !isSkilletSystemSkill(e),
          ).length
          const unionPulled = result.unionPull.filter((o) => o.status === 'updated').length
          const unionFailed = result.unionPull.filter((o) => o.status === 'failed')

          // Account truly has no kit skills — not "pull failed for skills list already showed".
          // (Past the pairing gate a bearer token is always present.)
          if (allSkills === 0 && result.unionPull.length === 0) {
            if (asJson) {
              process.stdout.write(
                JSON.stringify(
                  {
                    ok: true,
                    kitEmpty: true,
                    accountLinked: true,
                    adapters: result.adapters,
                    lockPath: result.lockPath,
                    unionPull: result.unionPull,
                  },
                  null,
                  2,
                ) + '\n',
              )
            } else {
              console.log(
                'No skills in your account kits yet. Publish on skillet.md, or import local skills with `skillet import <path>`',
              )
            }
            return
          }

          const syncedSkills = kitSyncedSkillEntries(stateAfter).length
          const localOnly = allSkills - syncedSkills
          const kitRefs = new Set(
            kitSyncedSkillEntries(stateAfter)
              .map((s) => s.sourceKit)
              .filter((k): k is string => typeof k === 'string' && k.length > 0),
          )

          const { groups: kitGroups, offline: kitGroupsOffline } = await loadDeviceKitGroups(
            stateAfter,
          )
          const skipReasons = skipReasonsFromSyncResult(result)
          const kitsJson: SyncKitGroupJson[] = buildSyncKitsJson(kitGroups, skipReasons, 'synced')

          if (asJson) {
            // Hooks still install on the JSON surface (the desktop tray syncs
            // this way); the consent question itself is TTY-only and deferred.
            await installRouteHooksWithConsent(result, { json: true })
            const failed = result.adapters.filter((a) => a.status === 'failed')
            process.stdout.write(
              JSON.stringify(
                {
                  ok: failed.length === 0 && unionFailed.length === 0,
                  lockPath: result.lockPath,
                  skillCount: syncedSkills,
                  libraryCount: allSkills,
                  localOnlyCount: localOnly,
                  kitCount: kitRefs.size,
                  kits: kitsJson,
                  unionPull: result.unionPull,
                  adapters: result.adapters,
                  materialized: result.materialized,
                  pruned: result.pruned,
                  trashDir: result.trashDir,
                  customized: result.customized,
                  localized: result.localized,
                  pendingReview: result.pendingReview,
                },
                null,
                2,
              ) + '\n',
            )
            if (failed.length > 0 || unionFailed.length > 0) {
              // See the --check branch: never process.exit() after a large JSON
              // write — it truncates piped stdout at 64KB mid-envelope.
              process.exitCode = ExitCode.ERROR
            }
            return
          }

          if (result.unionPull.length > 0) {
            const parts: string[] = []
            if (unionPulled > 0) parts.push(`${unionPulled} new/updated from registry`)
            const skipped = result.unionPull.filter((o) => o.status === 'unchanged').length
            if (skipped > 0) parts.push(`${skipped} unchanged`)
            if (unionFailed.length > 0) parts.push(`${unionFailed.length} failed`)
            console.log(
              `Registry kits: ${parts.join(', ')}${kitRefs.size > 0 ? ` · ${kitRefs.size} kit(s)` : ''}\n`,
            )
            for (const o of unionFailed) {
              for (const line of renderFailedPullLine(o)) {
                console.log(line)
              }
            }
          }

          const kitPlan = renderSyncKitPlan(kitGroups, {
            skipReasons,
            offline: kitGroupsOffline,
          })
          if (kitPlan.length > 0) {
            console.log(`${kitPlan}\n`)
          }

          for (const notice of result.notices) {
            console.log(`⚠  ${notice}`)
          }
          printPendingReviewSummary(result.pendingReview)
          // Customized skills with a held author update — a quiet, non-blocking
          // signal (R5), one line each, pointing at the reconcile surface. No
          // deadline, nothing reverted; `skillet edits` drives take/keep/diff.
          for (const c of result.customized) {
            if (!c.hasUpdate) continue
            console.log(
              `Your version of "${c.slug}" has an author update waiting. Reconcile with \`skillet edits\``,
            )
          }
          // A customized skill that left the manifest (unsubscribed / kit
          // removed) is kept as a plain local skill, not trashed (KTD7) — say
          // so quietly, same one-line style as the held-update notice above.
          for (const l of result.localized) {
            console.log(`Kept "${l.slug}" as your own local skill (unsubscribed).`)
          }
          if (result.pruned.length > 0 && result.trashDir) {
            const names = result.pruned.map((p) => p.slug).join(', ')
            console.log(`Removed ${result.pruned.length} skill(s) no longer in your kits: ${names}`)
            console.log(
              `  → moved to ${result.trashDir} (restore by moving the folders back, or delete to reclaim space)\n`,
            )
          }

          console.log('Agents:')
          for (const r of result.adapters) {
            console.log(renderAdapterLine(r))
            for (const w of r.warnings) {
              console.log(`    ${yellow('⚠')}  ${w}`)
            }
          }

          const detectedCount = result.adapters.filter(
            (a) => a.status !== 'skipped-not-detected',
          ).length
          const failedCount = result.adapters.filter((a) => a.status === 'failed').length

          console.log(dim(`\nLock written: ${result.lockPath}`))
          const syncLine =
            `Synced ${syncedSkills} kit skill(s) into ${detectedCount}/${result.adapters.length} agent(s)` +
            (kitRefs.size > 0 ? ` · ${kitRefs.size} kit(s)` : '')
          console.log(
            failedCount > 0
              ? fail(`${syncLine}. ${failedCount} agent(s) failed (see above)`)
              : ok(syncLine),
          )
          if (localOnly > 0) {
            console.log(
              `\n${localOnly} local skill(s) in your library were not synced (kit-exclusive).`,
            )
          }

          // U8: updates summary — how many incoming versions were applied this run.
          const appliedUpdates = [...result.pull, ...result.unionPull].filter(
            (o) => o.status === 'updated',
          ).length
          if (appliedUpdates > 0) {
            console.log(`Updates: ${appliedUpdates} applied this sync.`)
          }

          // Capture hint: local skills not yet on your profile. A one-liner, not a
          // prompt — points at the existing explicit, private-by-default publish.
          if (bearer.kind === 'session') {
            const capturable = Object.values(stateAfter.skills).filter(
              (s) => s.source === 'local' && !s.owner,
            ).length
            if (capturable > 0) {
              console.log(
                `\n${capturable} local skill(s) aren't on your profile yet. Publish them (private by default) at ${webBaseUrl()}/skills/new`,
              )
            }
          }

          if (detectedCount === 0) {
            console.log(`\n${yellow('⚠')}  No agents received skills. Check errors above.`)
          }

          // Hooks + the one-time stats-consent question come LAST (shared with
          // the pairing auto-sync): the sync outcome reads first and the run
          // ends on the question instead of burying it mid-output.
          await installRouteHooksWithConsent(result, { json: asJson })

          if (failedCount > 0 || unionFailed.length > 0) {
            exitWith(ExitCode.ERROR)
          }
        } catch (err) {
          // A revoked device / stale session (RegistryError 401/403, e.g.
          // machine_disconnected) is an auth failure, not a generic error:
          // exit AUTH so scripts and the tray route the user to re-pair
          // instead of surfacing it as a retryable ERROR.
          const authRejected =
            err instanceof RegistryError && (err.status === 401 || err.status === 403)
          const exit = authRejected ? ExitCode.AUTH : ExitCode.ERROR
          if (asJson) {
            // Narrow to RegistryError so incidental `.code` fields (e.g. a raw
            // fs ENOENT) never leak into the structured envelope contract.
            const code = err instanceof RegistryError ? err.code : undefined
            writeJsonError((err as Error).message, { ...(code ? { code } : {}), exitCode: exit })
          } else {
            printRenderedError(err as Error, (what) => fail(`Sync failed: ${what}`))
            exitWith(exit)
          }
        }
      },
    )
}
