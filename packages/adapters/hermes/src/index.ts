import { join, sep } from "node:path";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  materializeSlugDir,
  HERMES_DEFAULT_HOME,
  hermesProfileRoot,
  validateMaterializationPath,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

function resolveDefaultTargetDir(): string {
  // Precedence: active profile tree (Hermes scans ONLY the active profile's
  // skills; the sticky ~/.hermes/active_profile file names it), else the
  // home tree. HERMES_HOME composes upstream: both hermesProfileRoot() and
  // HERMES_DEFAULT_HOME already honor it (resolved once in pathsafe).
  // hermesProfileRoot() is lazy and INVOCATION-aware in core (U3): a Hermes
  // home resolving into a macOS-protected folder yields null for parked runs
  // (no content read), and the real active-profile tree for user-initiated
  // or granted-background runs. That is why the target dir must resolve at
  // USE time, never freeze at module load: the CLI parses flags and calls
  // setTccInvocation AFTER this module is imported.
  const profileRoot = hermesProfileRoot();
  if (profileRoot !== null) return profileRoot;
  return join(HERMES_DEFAULT_HOME, "skills");
}

function resolveDetectDir(): string {
  // detect() checks the hermes home itself — profile presence changes where
  // skills go, not whether Hermes is installed.
  return HERMES_DEFAULT_HOME;
}

export function createAdapter(baseDir?: string): Adapter {
  // Per-access resolution (not a frozen const): the profile read itself is
  // memoized in core, so this costs one content read per process at most,
  // and only when the invocation is allowed to perform it. Within one
  // command the invocation classification is stable, so every access
  // resolves consistently.
  const base = (): string => baseDir ?? resolveDefaultTargetDir();
  return {
    name: "hermes",
    get targetDir(): string {
      return base();
    },

    async detect(): Promise<boolean> {
      try {
        await access(resolveDetectDir());
        return true;
      } catch {
        return false;
      }
    },

    async materialize(
      slug: string,
      bundle: DecodedBundle,
      opts: MaterializeOptions = {},
    ): Promise<string[]> {
      assertSafeSlug(slug);
      const root = base();
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      validateMaterializationPath(root, slugDir);
      return writeBundleToDir(root, slugDir, bundle);
    },

    targetPath(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      const rel = `${slugDir}/SKILL.md`;
      const hostRel = sep === "/" ? rel : rel.split("/").join(sep);
      return join(base(), hostRel);
    },

    targetSkillDir(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      return join(base(), materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName }));
    },
  };
}

export const hermesAdapter: Adapter = createAdapter();
export default hermesAdapter;
