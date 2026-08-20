import type { Command } from 'commander';
import * as clack from '@clack/prompts';
import {
  RegistryClient,
  acceptAuthorKeyRotationWithInvalidation,
  compareAuthorPin,
  fetchServedAuthorKey,
  invalidateAfterKeyRotation,
  listPinnedHandles,
  loadPinnedKey,
  loadRegistryBearer,
  truncateKeyId,
} from '@skillet/core';
import { ExitCode, exitWith } from '../exit-codes.js';
import { REGISTRY_DEFAULT } from '../cli-context.js';

function normalizeHandleArg(raw: string): string {
  const handle = raw.startsWith('@') ? raw.slice(1) : raw;
  if (!/^[a-z0-9-]{1,64}$/.test(handle)) {
    console.error(`✗ Invalid handle ${JSON.stringify(raw)}`);
    exitWith(ExitCode.USAGE);
  }
  return handle;
}

function registryClient(token?: string): RegistryClient {
  return new RegistryClient({
    baseUrl: REGISTRY_DEFAULT,
    token,
  });
}

export function registerPinCommands(program: Command): void {
  const pin = program
    .command('pin', { hidden: true })
    .description('Author signing keys this machine trusts (pinned on first sync)');

  pin
    .command('list')
    .description('List handles with locally pinned author signing keys')
    .option('--json', 'Emit JSON')
    .action(async (opts: { json?: boolean }) => {
      const handles = await listPinnedHandles();
      if (opts.json) {
        process.stdout.write(JSON.stringify({ handles }, null, 2) + '\n');
        return;
      }
      if (handles.length === 0) {
        console.log('No pinned author keys on this device.');
        return;
      }
      console.log('Pinned author keys:');
      for (const handle of handles.sort()) {
        console.log(`  @${handle}`);
      }
    });

  pin
    .command('show <handle>')
    .description('Compare the local pin with the registry-served author key')
    .option('--json', 'Emit JSON')
    .option('--token <token>', 'Bearer token override')
    .action(async (handleArg: string, opts: { json?: boolean; token?: string }) => {
      const handle = normalizeHandleArg(handleArg);
      const bearer = await loadRegistryBearer(opts.token);
      const client = registryClient(bearer.token || undefined);
      let served: { key_id: string; pub: string } | null = null;
      try {
        const fetched = await fetchServedAuthorKey(handle, client);
        served = { key_id: fetched.key_id, pub: fetched.pub };
      } catch (err) {
        if (!opts.json) {
          console.error(`✗ Could not fetch registry key for @${handle}: ${(err as Error).message}`);
        }
        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                handle,
                pinned: await loadPinnedKey(handle),
                served: null,
                mismatch: false,
                fetchError: (err as Error).message,
              },
              null,
              2,
            ) + '\n',
          );
        }
        exitWith(ExitCode.ERROR);
      }

      const comparison = await compareAuthorPin(handle, undefined, served);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              handle: comparison.handle,
              pinned_key_id: comparison.pinned?.key_id ?? null,
              registry_key_id: comparison.served?.key_id ?? null,
              mismatch: comparison.mismatch,
            },
            null,
            2,
          ) + '\n',
        );
        return;
      }

      console.log(`Author pin for @${handle}`);
      if (comparison.pinned) {
        console.log(`  pinned:   ${comparison.pinned.key_id} (since ${comparison.pinned.pinned_at})`);
      } else {
        console.log('  pinned:   (none; the first sync pins the author key)');
      }
      if (comparison.served) {
        console.log(`  registry: ${comparison.served.key_id}`);
      }
      if (comparison.mismatch) {
        console.log('\n  mismatch: run `skillet pin accept ' + handle + '` to re-pin.');
      } else if (comparison.pinned && comparison.served) {
        console.log('\n  keys match.');
      }
    });

  pin
    .command('accept <handle>')
    .description('Accept the registry author key and replace a stale pin')
    .option('--yes', 'Skip confirmation prompt')
    .option('--token <token>', 'Bearer token override')
    .action(async (handleArg: string, opts: { yes?: boolean; token?: string }) => {
      const handle = normalizeHandleArg(handleArg);
      const bearer = await loadRegistryBearer(opts.token);
      const client = registryClient(bearer.token || undefined);

      let served: { key_id: string; pub: string };
      try {
        const fetched = await fetchServedAuthorKey(handle, client);
        served = { key_id: fetched.key_id, pub: fetched.pub };
      } catch (err) {
        console.error(`✗ Could not fetch registry key for @${handle}: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }

      const comparison = await compareAuthorPin(handle, undefined, served);
      if (!comparison.pinned) {
        await acceptAuthorKeyRotationWithInvalidation(handle, served);
        console.log(`✓ Pinned @${handle} to ${truncateKeyId(served.key_id)}.`);
        return;
      }
      if (!comparison.mismatch) {
        // Idempotent recovery: a matching pin can still sit over stale caches
        // (a manual re-pin, or a crash between the pin write and invalidation).
        // Re-running accept always unmasks a stale `unchanged` sync.
        await invalidateAfterKeyRotation(handle);
        console.log(`✓ @${handle} is already pinned to the registry key (${truncateKeyId(served.key_id)}).`);
        return;
      }

      const pinnedShort = truncateKeyId(comparison.pinned.key_id);
      const servedShort = truncateKeyId(served.key_id);
      let accepted = opts.yes === true;
      if (!accepted) {
        if (process.stdout.isTTY !== true) {
          console.error(
            `✗ Author key changed for @${handle} (${pinnedShort} → ${servedShort}). Re-run with --yes in non-interactive mode.`,
          );
          exitWith(ExitCode.ERROR);
        }
        const answer = await clack.confirm({
          message:
            `Accept new signing key for @${handle}?\n  pinned: ${pinnedShort}\n  registry: ${servedShort}`,
        });
        if (clack.isCancel(answer) || answer !== true) {
          console.log('Pin unchanged.');
          return;
        }
        accepted = true;
      }

      if (accepted) {
        await acceptAuthorKeyRotationWithInvalidation(handle, served);
        console.log(`✓ Re-pinned @${handle} to ${servedShort}. Run \`skillet sync\` to pull affected skills.`);
      }
    });
}
