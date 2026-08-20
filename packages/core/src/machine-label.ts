import { execSync } from 'node:child_process';
import { hostname } from 'node:os';

function readMacComputerName(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const name = execSync('scutil --get ComputerName', {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Default label for a newly connected sync machine (Settings → Devices). */
export function defaultMachineLabel(): string {
  const friendly =
    readMacComputerName() ??
    process.env['COMPUTERNAME']?.trim() ??
    process.env['HOSTNAME']?.trim() ??
    hostname().trim();
  const label = friendly && friendly !== 'localhost' ? friendly : 'Unnamed machine';
  return label.slice(0, 80);
}
