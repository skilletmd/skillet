import { RegistryClient } from './client.js';

/** Best-effort install counter — never fail the caller path. */
export function pingInstallMetric(client: RegistryClient, ref: string): void {
  void client.recordInstall(ref).catch(() => undefined);
}
