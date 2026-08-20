// Rogue-agent markers.
//
// Two shapes: (1) self-modification — a skill rewriting its own source / SKILL.md
// or stripping its own safety checks; (2) persistence — installing a cron job,
// shell-rc hook, systemd/launchd unit, or backgrounded daemon to survive beyond
// the invocation.
//
// The unambiguous self-write code shapes (`open(__file__,'w')`,
// `open('SKILL.md', 'w')`) are `high` and script-gated. NOTE: we deliberately do
// NOT flag the prose "edit the SKILL.md" — that is exactly what a legitimate
// skill-authoring guide instructs (see skills/write-a-skill). Self-modification
// prose is matched only with a clear self-referential possessive. Persistence is
// `medium` (script-gated code) or `low` (prose).

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile } from '../util.js';

const onlyScripts = (_m: RegExpExecArray, file: string) => isScriptFile(file);

const PATTERNS = [
  // RA1 — self-modification (code shapes).
  {
    category: 'rogue-agent' as const,
    detector: 'self-write-file',
    confidence: 'high' as const,
    // open(__file__, 'w'), Path(__file__).write_text(...), open('SKILL.md', ... 'w')
    pattern:
      /\bopen\s*\(\s*__file__\s*,\s*['"][wa]|(?:Path|pathlib)\s*\(\s*__file__\s*\)\s*\.\s*write_text|\bopen\s*\(\s*['"](?:SKILL|skill)\.md['"][^)]*['"][wa]/g,
    accept: onlyScripts,
  },
  // RA1 — self-modification (prose with self-referential possessive).
  {
    category: 'rogue-agent' as const,
    detector: 'modify-own-code',
    confidence: 'medium' as const,
    pattern:
      /\b(?:modify|edit|change|rewrite|update|alter|overwrite|patch)\s+(?:your\s+own|its\s+own|this\s+skill(?:'s)?)\s+(?:code|source|file|script|config|configuration|instructions?|rules?)\b|\bself[_-]?(?:modify|update|rewrite|patch|evolve)\b/gi,
  },
  {
    category: 'rogue-agent' as const,
    detector: 'disable-safety-check',
    confidence: 'medium' as const,
    pattern:
      /\b(?:disable|remove|delete|bypass|comment\s+out)\s+(?:the\s+)?(?:safety|security|guard|protection|validation|verification)\s+(?:check|rule|mechanism|feature|guard|assertion)s?\b/gi,
  },
  // RA2 — persistence (code shapes, script-gated).
  {
    category: 'rogue-agent' as const,
    detector: 'cron-persistence',
    confidence: 'medium' as const,
    pattern: /\bcrontab\s+(?:-[el]\b|[^\n]*>>?\s*\/)/g,
    accept: onlyScripts,
  },
  {
    category: 'rogue-agent' as const,
    detector: 'shellrc-persistence',
    confidence: 'medium' as const,
    // Appending to ~/.bashrc / ~/.zshrc / ~/.profile etc.
    pattern: />>?\s*(?:~\/|\$HOME\/|\/home\/[^\s/]+\/)?\.(?:bashrc|zshrc|profile|bash_profile|login|cshrc)\b/g,
    accept: onlyScripts,
  },
  {
    category: 'rogue-agent' as const,
    detector: 'service-persistence',
    confidence: 'medium' as const,
    // systemctl enable, launchctl load, reg add, defaults write, nohup/setsid/disown
    pattern:
      /\b(?:systemctl\s+enable|launchctl\s+load|reg\s+add\s+HK|defaults\s+write)\b|\b(?:nohup|setsid|disown)\s+/gi,
    accept: onlyScripts,
  },
  // RA2 — persistence (prose).
  {
    category: 'rogue-agent' as const,
    detector: 'install-startup-task',
    confidence: 'low' as const,
    pattern:
      /\b(?:add|create|install|register|schedule)\s+(?:a\s+)?(?:cron\s+(?:job|task)|(?:recurring|periodic|startup|boot|autostart|login)\s+(?:task|job|script|service|daemon|item))\b/gi,
  },
];

export const rogueAgentDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
