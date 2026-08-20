// Single signing entry point for browser propose, approve,
// and publish.
//
// After the "option c" convergence, the registry's
// `resolveAndVerifySigner` accepts signatures ONLY from the user's PRIMARY key
// or from a registered DEVICE delegation with the matching scope. This helper
// prefers the enrolled device key when this browser holds an active delegation
// (publish scope required for publish; propose/approve for those flows).

import { fetchDelegations } from './enroll-device'
import {
  hasDeviceKey,
  loadDeviceKey,
  signContentHashWithDevice,
  type DeviceSignature,
} from './device-key'
import { signContentHash, type BrowserSignature } from './browser-author-key'

/** `{alg:'ed25519', key_id, sig}` — same shape whether device- or primary-signed. */
export type ProposalSignature = DeviceSignature | BrowserSignature

async function deviceHasScope(scope: string): Promise<boolean> {
  const device = await loadDeviceKey()
  if (!device) return false
  try {
    const delegations = await fetchDelegations()
    return delegations.some(
      (d) =>
        d.device_key_id === device.deviceKeyId && d.status === 'active' && d.scopes.includes(scope),
    )
  } catch {
    return false
  }
}

/**
 * Sign a canonical `content_hash` for a proposal or approval, choosing the
 * device delegation key when this browser is enrolled, else the browser author
 * key (web-primary users).
 */
export async function signContentHashForProposal(contentHash: string): Promise<ProposalSignature> {
  if (await hasDeviceKey()) {
    return signContentHashWithDevice(contentHash)
  }
  return signContentHash(contentHash)
}

/** Sign for POST /skills — device key when delegation includes `publish`, else primary browser key. */
export async function signContentHashForPublish(contentHash: string): Promise<ProposalSignature> {
  if (await deviceHasScope('publish')) {
    return signContentHashWithDevice(contentHash)
  }
  return signContentHash(contentHash)
}
