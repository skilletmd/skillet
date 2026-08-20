// Privilege-escalation + sensitive-credential-file access.
//
// Three shapes: (1) reading well-known credential/secret files (SSH keys, cloud
// creds, /etc/shadow, browser stores) — high-signal path strings; (2) privilege
// elevation commands (sudo -s, su root, setuid chmod) — script-gated code
// shapes; (3) prose demands for "full access" / "escalate privileges".
//
// All capped at `medium`. Even /etc/shadow stays advisory: auto-quarantine is
// off at launch (conditional-go), and a credential-file path can appear
// in legitimate hardening/audit documentation. Prose intent is `low`.

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile, notDefensive } from '../util.js';

const onlyScripts = (_m: RegExpExecArray, file: string) => isScriptFile(file);
// The shared `notDefensive` acceptor (util.ts) skips a match that is describing
// secure storage or documenting a best practice ("tokens are encrypted in the
// keychain", "grant all privileges … best practice") — those describe, they do
// not exfiltrate or demand.

const PATTERNS = [
  // PE3 — sensitive credential/secret file access. Path strings; run on all
  // text files (a skill body that points the agent at ~/.ssh/id_rsa is the
  // signal regardless of file type).
  {
    category: 'privilege-escalation' as const,
    detector: 'ssh-private-key-path',
    confidence: 'medium' as const,
    // `(?!\.pub)` — `~/.ssh/id_rsa.pub` is a PUBLIC key; referencing it (VM
    // provisioning: `cat ~/.ssh/id_rsa.pub`) is benign, not private-key access.
    pattern: /(?:^|[\s'"`(=/~])\.ssh\/(?:id_rsa|id_ed25519|id_ecdsa|id_dsa|authorized_keys)(?!\.pub)\b/g,
  },
  {
    category: 'privilege-escalation' as const,
    detector: 'cloud-credentials-path',
    confidence: 'medium' as const,
    // ~/.aws/credentials, ~/.config/gcloud/, ~/.kube/config, ~/.docker/config.json
    pattern:
      /(?:^|[\s'"`(=/~])\.(?:aws\/credentials|config\/gcloud\/|kube\/config|docker\/config\.json|git-credentials|netrc|npmrc)\b/g,
  },
  {
    category: 'privilege-escalation' as const,
    detector: 'etc-shadow-passwd',
    confidence: 'medium' as const,
    // Real escalation targets: the password HASHES (/etc/shadow) and sudo config
    // (/etc/sudoers). `/etc/passwd` is deliberately EXCLUDED — it is world-
    // readable (reading it is not escalation) and is THE canonical path-traversal
    // example in security docs (`// Could be ../../../etc/passwd`), so matching it
    // is almost always a false positive.
    pattern: /\/etc\/(?:shadow|sudoers)\b/g,
  },
  {
    category: 'privilege-escalation' as const,
    detector: 'browser-credential-store',
    confidence: 'medium' as const,
    // Chrome/Firefox/Safari cookie & login stores; keychain/keyring access.
    pattern:
      /\b(?:Login\s+Data|key4\.db|cookies\.sqlite|keychain|gnome-keyring)\b|(?:Chrome|Firefox|Safari|Edge)\/[^\n]{0,40}(?:Cookies|Login\s+Data)/gi,
    accept: notDefensive,
  },
  // PE2 — privilege elevation commands. Script-gated code shapes.
  {
    category: 'privilege-escalation' as const,
    detector: 'sudo-interactive-shell',
    confidence: 'medium' as const,
    // sudo -s/-i/-E, sudo su, su root, doas, pkexec — escalation to a shell.
    pattern: /\bsudo\s+-[isSE]\b|\bsudo\s+su\b|\bsu\s+(?:-\s*$|root\b)|\bdoas\s+|\bpkexec\s+/gm,
    accept: onlyScripts,
  },
  {
    category: 'privilege-escalation' as const,
    detector: 'setuid-chmod',
    confidence: 'medium' as const,
    // chmod u+s / chmod 4755 — set-user-ID bit, classic privesc persistence.
    pattern: /\bchmod\s+(?:[ugoa]*[+-=][a-rt-z]*s|[0-7]*[4567][0-7]{2})\b/g,
    accept: onlyScripts,
  },
  // PE1 — prose demands for elevated access.
  {
    category: 'privilege-escalation' as const,
    detector: 'demand-full-access',
    confidence: 'low' as const,
    pattern:
      /\b(?:grant|give|request|require|need)s?\s+(?:me\s+)?(?:full|all|complete|root|admin)\s+(?:access|permissions?|privileges?)\b/gi,
    accept: notDefensive,
  },
  {
    category: 'privilege-escalation' as const,
    detector: 'escalate-privileges',
    confidence: 'low' as const,
    pattern:
      /\b(?:escalate|elevate|upgrade)\s+(?:my\s+|your\s+)?(?:permissions?|privileges?|access)\b|\b(?:bypass|skip|ignore)\s+(?:permission|access)\s+(?:check|validation|restriction)s?\b/gi,
  },
];

export const privilegeEscalationDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
