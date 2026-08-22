/**
 * One-off repair for kit names generated before the humanizer was shared.
 *
 * The registry used to build a linked kit's name with a bare
 * `\b\w -> uppercase`, so `ibelick/ui-skills` was stored as the kit "Ui Skills"
 * and `phuryn/pm-skills` as "Pm Skills", while the same repos' skills rendered
 * "UI Skills Root" through the web's acronym-aware humanizer. Both sides now
 * share `@skillet/protocol/humanize`, but a kit's name is STORED at create
 * time and re-sync deliberately never overwrites it (owners may rename a linked
 * kit, and the pull must preserve that). So already-created rows need this.
 *
 * Safety: a row is only renamed when its CURRENT name is exactly what the old
 * generator would have produced for its own `source_repo`. An owner-renamed kit
 * never matches, so it is left alone.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env scripts/repair-kit-names.ts            # dry run
 *   npx tsx --env-file-if-exists=.env scripts/repair-kit-names.ts --apply
 */
import { pathToFileURL } from 'node:url';
import { humanizeSlug } from '@skillet/protocol/humanize';
import { createPrismaClient } from '../src/db/prisma-client.js';

/** The generator this script exists to undo. Frozen on purpose — do not "fix". */
function legacyHumanizeRepo(repo: string): string {
  return repo
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  try {
    const kits = await prisma.kits.findMany({
      where: { source_repo: { not: null } },
      select: { id: true, owner_id: true, slug: true, name: true, source_repo: true },
    });

    const repairs: { id: string; owner: string; slug: string; from: string; to: string }[] = [];
    let renamedByOwner = 0;
    for (const kit of kits) {
      const repo = (kit.source_repo ?? '').split('/').pop() ?? '';
      if (!repo) continue;
      const legacy = legacyHumanizeRepo(repo);
      const fixed = humanizeSlug(repo);
      if (fixed === kit.name) continue;
      if (kit.name !== legacy) {
        renamedByOwner++;
        continue;
      }
      repairs.push({
        id: kit.id,
        owner: kit.owner_id,
        slug: kit.slug ?? '',
        from: kit.name,
        to: fixed,
      });
    }

    for (const r of repairs) {
      console.log(`  ${r.from}  ->  ${r.to}    (@${r.owner}/kit/${r.slug})`);
    }
    console.log(
      `\n${kits.length} linked kits, ${repairs.length} to repair, ` +
        `${renamedByOwner} skipped (name no longer matches the generator, treat as owner-set).`,
    );

    if (!apply) {
      console.log('dry run — pass --apply to write.');
      return;
    }
    for (const r of repairs) {
      await prisma.kits.update({ where: { id: r.id }, data: { name: r.to } });
    }
    console.log(`renamed ${repairs.length} kits.`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
