import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Whether this machine can create directory symlinks.
 *
 * Windows gates `symlink()` behind SeCreateSymbolicLinkPrivilege — granted to
 * administrators, or to any account once Developer Mode is on — so an ordinary
 * contributor shell throws EPERM before the assertion under test is ever
 * reached. Suites that build a fixture out of symlinks (the TCC parked-root
 * scenarios) opt out with this rather than assuming the platform: a Windows
 * machine with Developer Mode still runs them, and macOS and Linux are
 * unaffected.
 *
 * Probed once at import: creating a symlink is the only reliable way to know,
 * since the privilege is not exposed to Node.
 */
export const symlinksAvailable: boolean = (() => {
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(tmpdir(), 'skillet-symlink-probe-'));
    const target = join(probe, 'target');
    mkdirSync(target);
    symlinkSync(target, join(probe, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    if (probe) {
      try {
        rmSync(probe, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
})();
