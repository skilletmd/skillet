/**
 * Ed25519 author key management and bundle verification.
 *
 * Security invariants (non-negotiable):
 *   - Private keys are NEVER stored in any registry path or PR-mergeable file.
 *   - Private keys are written to $XDG_CONFIG_HOME/skillet/keys/<keyId>.sk at mode 0600.
 *   - Verification is client-side only, fail-closed: throw before any materialization.
 *   - The Skillet release key public half is hardcoded here; the private half lives on
 *     an air-gapped machine and is never committed to this repository.
 */
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHash,
  type KeyObject,
} from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  chmod,
  unlink,
  lstat,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { enforcesUnixFilePermissions } from "../util/unix-perms.js";

// Skillet release public key — hardcoded for adapter manifest verification.
// The corresponding private key is held on an air-gapped machine (separate offline
// key ceremony). Rotation requires a new signed binary release.
// NEVER commit the private key. To replace: run offline ceremony, paste hex here,
// ship new binary.
const SKILLET_RELEASE_PUBLIC_KEY_HEX =
  "8c803b7de8f43c4b9bef171f95767659eebd10846a591e5f1206c571cd880154";

// keyId must be exactly 64 lowercase hex characters (32-byte Ed25519 public key).
// Validated before any filepath.join to prevent path traversal via crafted keyIds
// sourced from untrusted registry manifests.
const VALID_KEY_ID_RE = /^[0-9a-f]{64}$/;

const ED25519_SIG_BYTES = 64;

export interface AuthorKey {
  keyId: string; // hex-encoded 32-byte Ed25519 public key
  publicKey: KeyObject;
  privateKey?: KeyObject; // undefined in verification-only contexts
}

/** Returns the hex KeyID for a public KeyObject. */
function publicKeyToKeyId(pub: KeyObject): string {
  const jwk = pub.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

/** Generates a fresh Ed25519 key pair. Private key is NOT persisted here — call saveAuthorKey immediately. */
export function generateAuthorKey(): AuthorKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId: publicKeyToKeyId(publicKey),
    publicKey,
    privateKey,
  };
}

function keyDir(configDir: string): string {
  return join(configDir, "skillet", "keys");
}

function skPath(configDir: string, keyId: string): string {
  return join(keyDir(configDir), `${keyId}.sk`);
}

/**
 * Writes the private key to <configDir>/skillet/keys/<keyId>.sk at mode 0600.
 * Directory is created at mode 0700 if absent. Uses temp+rename for atomicity.
 * configDir MUST be the XDG_CONFIG_HOME path — never a registry or project directory.
 */
export async function saveAuthorKey(
  key: AuthorKey,
  configDir: string
): Promise<void> {
  if (!key.privateKey) {
    throw new Error("Cannot save author key: private key is undefined");
  }

  const dir = keyDir(configDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const pkcs8Der = key.privateKey.export({
    type: "pkcs8",
    format: "der",
  }) as Buffer;
  const encoded = pkcs8Der.toString("hex");

  const path = skPath(configDir, key.keyId);
  const tmp = `${path}.tmp`;

  try {
    await writeFile(tmp, encoded, { encoding: "utf8", mode: 0o600 });
    await chmod(tmp, 0o600); // explicit: overrides umask
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // best effort cleanup
    }
    throw err;
  }
}

/**
 * Loads the first author key found in <configDir>/skillet/keys/.
 * Use loadAuthorKeyById for multi-key setups.
 */
export async function loadAuthorKey(configDir: string): Promise<AuthorKey> {
  const dir = keyDir(configDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(`No author key found in ${dir}`);
  }
  for (const entry of entries) {
    if (entry.endsWith(".sk")) {
      const keyId = entry.slice(0, -3);
      if (VALID_KEY_ID_RE.test(keyId)) {
        return loadAuthorKeyById(configDir, keyId);
      }
    }
  }
  throw new Error(`No author key found in ${dir}`);
}

/**
 * Loads a specific author key by KeyID (hex-encoded public key).
 * Validates the keyId format before constructing any path.
 */
export async function loadAuthorKeyById(
  configDir: string,
  keyId: string
): Promise<AuthorKey> {
  if (!VALID_KEY_ID_RE.test(keyId)) {
    throw new Error(
      `Invalid key ID "${keyId}": must be 64 lowercase hex characters`
    );
  }

  const path = skPath(configDir, keyId);

  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(
      `Key file ${path} is a symlink; refusing to load`
    );
  }
  if (enforcesUnixFilePermissions() && (info.mode & 0o077) !== 0) {
    const perm = (info.mode & 0o777).toString(8).padStart(4, "0");
    throw new Error(
      `Key file ${path} has insecure permissions ${perm}; expected 0600`
    );
  }

  const raw = await readFile(path, "utf8");
  const pkcs8Der = Buffer.from(raw.trim(), "hex");

  const privateKey = createPrivateKey({
    key: pkcs8Der,
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);

  const derivedKeyId = publicKeyToKeyId(publicKey);
  if (derivedKeyId !== keyId) {
    throw new Error(
      `Key file ID mismatch: file says ${keyId}, derived public key is ${derivedKeyId}`
    );
  }

  return { keyId, publicKey, privateKey };
}

/**
 * Signs SHA-256(bundle) with the author's Ed25519 private key.
 * Returns a 64-byte signature.
 * Throws if privateKey is absent (verification-only key).
 */
export function signBundle(bundle: Buffer, key: AuthorKey): Buffer {
  if (!key.privateKey) {
    throw new Error(
      "Cannot sign: private key is undefined (verification-only key)"
    );
  }
  const digest = createHash("sha256").update(bundle).digest();
  return sign(null, digest, key.privateKey);
}

/**
 * Verifies that sig is a valid Ed25519 signature over SHA-256(bundle) by publicKey.
 * Throws a descriptive error for every failure mode.
 *
 * MUST be called before any file is materialized. Callers must treat any thrown
 * error as a hard stop: refuse materialization, exit non-zero, no partial writes.
 */
export function verifyBundle(
  bundle: Buffer,
  sig: Buffer,
  publicKey: KeyObject
): void {
  if (!sig || sig.length === 0) {
    throw new Error(
      "Signature verification failed: missing or empty signature"
    );
  }
  if (sig.length !== ED25519_SIG_BYTES) {
    throw new Error(
      `Signature verification failed: invalid length ${sig.length} (expected ${ED25519_SIG_BYTES})`
    );
  }
  if (sig.every((b) => b === 0)) {
    throw new Error(
      "Signature verification failed: all-zero signature rejected"
    );
  }

  const digest = createHash("sha256").update(bundle).digest();
  const valid = verify(null, digest, publicKey, sig);
  if (!valid) {
    throw new Error(
      "Signature verification failed: signature does not match bundle content"
    );
  }
}

/**
 * Returns the hardcoded Skillet release public key used to verify adapter manifests.
 * Not user-configurable. Each call returns an independent KeyObject.
 */
export function skilletReleasePublicKey(): KeyObject {
  const raw = Buffer.from(SKILLET_RELEASE_PUBLIC_KEY_HEX, "hex");
  const jwk = { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") };
  return createPublicKey({ key: jwk, format: "jwk" });
}
