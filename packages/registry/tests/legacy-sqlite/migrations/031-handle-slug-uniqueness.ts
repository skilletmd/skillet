import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/**
 * Guard migration for global handle/slug uniqueness.
 *
 * User handles and organization slugs share the `authors.id` namespace and are
 * resolved as interchangeable owner identifiers, but historically each had only
 * a table-local UNIQUE constraint — a handle and a slug could collide, letting
 * the wrong principal manage an org-owned kit/skill.
 *
 * Going forward, the claim / org-create / GitHub-signup write paths reject
 * cross-namespace collisions. This migration fails loudly if any collision
 * already exists, so an operator renames one side before deploying rather than
 * the migration silently mutating a user-facing identifier. With zero existing
 * collisions (the expected case) it is a no-op recorded at version 29.
 */
export const migration031HandleSlugUniqueness: RegistryMigration = {
  version: 31,
  name: 'handle_slug_uniqueness',
  up: (db) => {
    const collisions = query<{ handle: string }>(
      db,
      `SELECT handle FROM users
         WHERE handle IS NOT NULL
           AND handle IN (SELECT slug FROM organizations)`,
    );
    if (collisions.length > 0) {
      const names = collisions.map((c) => c.handle).join(', ');
      throw new Error(
        `handle/slug collision(s) block migration 031: ${names}. ` +
          'A user handle and an organization slug share a name. Rename one side ' +
          'before deploying so global handle/slug uniqueness can be enforced.',
      );
    }
  },
};
