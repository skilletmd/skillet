import type { RegistryMigration } from '../migrate-runner.js';
import { migrateRegistryBaseline } from '../legacy-migrate.js';

/** Pre-ledger baseline: entire registry schema through blob storage_loc. */
export const migration001RegistryBaseline: RegistryMigration = {
  version: 1,
  name: 'registry_baseline',
  up: migrateRegistryBaseline,
};
