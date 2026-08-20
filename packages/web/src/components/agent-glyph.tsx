import {
  AmpLogo,
  AntigravityLogo,
  ClaudeCodeLogo,
  ClaudeLogo,
  CodexLogo,
  CopilotLogo,
  CursorLogo,
  DevinLogo,
  GeminiLogo,
  HermesLogo,
  KimiLogo,
  OpenAiLogo,
  OpenClawLogo,
  OpenCodeLogo,
  RooCodeLogo,
  ZedLogo,
} from '@/components/brand-logos'

/**
 * One monochrome glyph per agent runtime. Real brand marks where we ship them (all
 * `currentColor` line-art); a clean bold monogram otherwise, so a row of agents reads
 * as one cohesive set. Shared by the settings picker and the public profile.
 */
export function AgentGlyph({ runtime, className }: { runtime: string; className?: string }) {
  switch (runtime) {
    case 'claude-code':
      return <ClaudeCodeLogo className={className} />
    case 'claude-ai':
      return <ClaudeLogo className={className} />
    case 'codex':
      return <CodexLogo className={className} />
    case 'chatgpt':
      return <OpenAiLogo className={className} />
    case 'cursor':
      return <CursorLogo className={className} />
    case 'hermes':
      return <HermesLogo className={className} />
    case 'openclaw':
      return <OpenClawLogo className={className} />
    case 'gemini':
      return <GeminiLogo className={className} />
    case 'copilot':
      return <CopilotLogo className={className} />
    case 'zed':
      return <ZedLogo className={className} />
    case 'opencode':
      return <OpenCodeLogo className={className} />
    case 'amp':
      return <AmpLogo className={className} />
    // Devin Desktop (né Windsurf): show the Devin brand mark after the rebrand.
    case 'windsurf':
      return <DevinLogo className={className} />
    case 'devin':
      return <DevinLogo className={className} />
    case 'kimi':
      return <KimiLogo className={className} />
    case 'antigravity':
      return <AntigravityLogo className={className} />
    case 'roo':
      return <RooCodeLogo className={className} />
    default:
      return (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center text-2xs font-bold uppercase leading-none"
        >
          {runtime.charAt(0)}
        </span>
      )
  }
}
