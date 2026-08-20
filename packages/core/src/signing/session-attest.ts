/**
 * Registry versions published under a verified session (web/desktop).
 */
import {
  SIG_ALG_SESSION,
  SIG_ALG_ED25519,
  type Ed25519Signature,
  type SessionAttestedSignature,
  type Signature,
} from "./envelope.js";

export { SIG_ALG_SESSION };

export function isSessionAttestedSignature(
  envelope: Signature | null | undefined,
): envelope is SessionAttestedSignature {
  return envelope?.alg === SIG_ALG_SESSION;
}

export function isEd25519Signature(
  envelope: Signature | null | undefined,
): envelope is Ed25519Signature {
  return envelope?.alg === SIG_ALG_ED25519;
}
