import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TrustPanel } from './trust-panel'
import { SKILLET_EVENTS } from '@/lib/events'
import { skillHref, skillViewHref } from '@/lib/urls'
import type { SkillCapability, SecurityFinding } from '@/lib/types'

afterEach(cleanup)

function ev(
  file: string,
  lineStart: number,
  lineEnd = lineStart,
  source: 'code' | 'instructions' = 'code',
): SkillCapability['evidence'][number] {
  return { file, lineStart, lineEnd, source }
}

function captureReveals() {
  const events: Array<{ path: string; line: number }> = []
  const onReveal = (e: Event) => events.push((e as CustomEvent).detail)
  window.addEventListener(SKILLET_EVENTS.revealFinding, onReveal)
  return {
    events,
    stop: () => window.removeEventListener(SKILLET_EVENTS.revealFinding, onReveal),
  }
}

// A permission row, the Safety card, and the "Also noticed" note are each their
// own disclosure.
const openRow = (label: RegExp) => fireEvent.click(screen.getByRole('button', { name: label }))

describe('TrustPanel — three zones', () => {
  // --- AE1: one capability + no findings → neutral row, quiet clean line -----

  it('AE1: one capability renders a neutral permission row and a quiet clean line, no Safety card', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('fetch.ts', 3)] },
    ]
    const { container } = render(<TrustPanel capabilities={capabilities} analysis="full" />)

    // Permissions card: the one used capability, neutral (no caution marker).
    expect(screen.getByText('Permissions')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Use the internet/ })
    expect(row).toHaveAttribute('data-caution', 'false')

    // A clean scan says nothing — no redundant "nothing concerning" line, no card.
    expect(screen.queryByText(/nothing concerning/)).not.toBeInTheDocument()
    expect(screen.queryByText('Safety')).not.toBeInTheDocument()
    expect(container.querySelector('[data-status="serious"]')).toBeNull()

    // Never a raw emitted id, never the word "safe".
    expect(container.textContent?.toLowerCase()).not.toMatch(/\bsafe\b/)
    expect(container.textContent).not.toContain('network-egress')
  })

  it('folds a redundant curl|sh (fetch-pipe-shell) away when network + runs-shell are both shown', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('SKILL.md', 3)] },
      { capability: 'runs-shell', risky: false, evidence: [ev('SKILL.md', 3)] },
    ]
    const findings: SecurityFinding[] = [
      { category: 'exfil', confidence: 'medium', file: 'SKILL.md', line: 3, why: 'exfil:fetch-pipe-shell' },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" findings={findings} />)
    // The two capability chips carry it; no redundant "Send data out" chip.
    expect(screen.getByRole('button', { name: /Use the internet/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run commands/ })).toBeInTheDocument()
    expect(screen.queryByText(/Send data out/)).not.toBeInTheDocument()
  })

  it('keeps the fetch-pipe-shell chip when the implied capabilities are NOT both present', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('SKILL.md', 3)] },
    ]
    const findings: SecurityFinding[] = [
      { category: 'exfil', confidence: 'medium', file: 'SKILL.md', line: 3, why: 'exfil:fetch-pipe-shell' },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" findings={findings} />)
    // Only "Use the internet" is shown, so the finding is not fully covered — it stays.
    expect(screen.getByText(/Send data out/)).toBeInTheDocument()
  })

  it('caps evidence by LOCATION count (not by file) and toggles the fold', () => {
    // 8 locations across only 2 files. A file cap (≤4 files) would show all 8;
    // the location cap (6) folds 2 away — proving the cap counts lines, so one
    // chatty file cannot dominate the preview.
    const capabilities: SkillCapability[] = [
      {
        capability: 'network',
        risky: false,
        evidence: [
          ...[1, 2, 3, 4].map((l) => ev('a.ts', l)),
          ...[1, 2, 3, 4].map((l) => ev('b.ts', l)),
        ],
      },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" />)
    openRow(/Use the internet/)
    // 8 locations, 6 shown → 2 behind the fold.
    expect(screen.getByRole('button', { name: 'Show 2 more lines' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more lines' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Show 2 more lines' })).toBeInTheDocument()
  })

  // --- AE2: sub-serious action findings inform, no Safety card --------------

  it('AE2: a sub-serious exfil gets its own neutral row; a sub-serious destructive folds in WITHOUT a marker', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'deletes-files', risky: false, evidence: [ev('clean.sh', 4)] },
    ]
    const findings: SecurityFinding[] = [
      // exfil (low, action, no permission home) → its own "Send data out" row.
      { category: 'exfil', confidence: 'low', file: 'out.sh', line: 7, why: 'Pipes data out.' },
      // destructive (medium, action, tagged deletes-files) → folds into the row,
      // NEUTRAL (no caution marker — R7).
      { category: 'destructive', confidence: 'medium', file: 'clean.sh', line: 99, why: 'rm -rf.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={capabilities} analysis="full" findings={findings} />,
    )

    // No red Safety card — nothing serious.
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
    expect(screen.queryByText(/Blocked/)).not.toBeInTheDocument()

    // The Delete-files row carries NO caution marker for the sub-serious finding.
    expect(screen.getByRole('button', { name: /Delete files/ })).toHaveAttribute(
      'data-caution',
      'false',
    )

    // exfil is a flagged finding chip — caution-tinted (Option A) and it sorts
    // to the front; open it for the evidence.
    const sendRow = screen.getByRole('button', { name: /Send data out/ })
    expect(sendRow).toHaveAttribute('data-caution', 'true')
    fireEvent.click(sendRow)
    expect(screen.getByText(/Moves data to an outside destination/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'out.sh:7' })).toBeInTheDocument()
    expect(screen.getByText('Pipes data out.')).toBeInTheDocument()

    // The folded destructive evidence is reachable under the Delete-files row.
    openRow(/Delete files/)
    expect(screen.getByRole('button', { name: 'clean.sh:99' })).toBeInTheDocument()
    expect(screen.getByText('rm -rf.')).toBeInTheDocument()

    // Raw category ids never reach the surface.
    expect(screen.queryByText(/^exfil$/)).not.toBeInTheDocument()
    expect(screen.queryByText('destructive')).not.toBeInTheDocument()
  })

  // --- Sub-serious content finding → a chip in "What this skill can do" ------

  it('a registry-risky capability carries NO caution marker when nothing is serious (no Safety card to point at)', () => {
    // The screenshot bug: a skill with risky capabilities but only a sub-serious
    // finding read "nothing serious" yet showed amber triangles pointing at a
    // Safety card that never rendered.
    const capabilities: SkillCapability[] = [
      { capability: 'runs-shell', risky: true, evidence: [ev('run.sh', 1)] },
      { capability: 'reads-secrets', risky: true, evidence: [ev('env.sh', 2)] },
    ]
    const findings: SecurityFinding[] = [
      { category: 'injection', confidence: 'medium', file: 'SKILL.md', line: 3, why: 'x.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={capabilities} analysis="full" findings={findings} />,
    )
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
    expect(screen.getByRole('button', { name: /Run commands/ })).toHaveAttribute('data-caution', 'false')
    expect(screen.getByRole('button', { name: /Read env variables/ })).toHaveAttribute('data-caution', 'false')
  })

  it('a registry-risky capability DOES carry the caution marker when something is serious', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'runs-shell', risky: true, evidence: [ev('run.sh', 1)] },
    ]
    const findings: SecurityFinding[] = [
      { category: 'exfil', confidence: 'high', file: 'x.sh', line: 1, why: 'out.' },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" findings={findings} />)
    // Serious card present → the risky capability now points to it.
    expect(screen.getByRole('button', { name: /Run commands/ })).toHaveAttribute('data-caution', 'true')
  })

  it('AE3: a medium prompt-injection is a flag chip under Permissions, not Safety', () => {
    const findings: SecurityFinding[] = [
      { category: 'injection', confidence: 'medium', file: 'SKILL.md', line: 3, why: 'Redirects the agent.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={null} findings={findings} analysis="full" />,
    )

    // No Safety card — it informs in the chip list instead.
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
    expect(screen.getByText('Permissions')).toBeInTheDocument()

    // The chip names it; a flagged finding is caution-tinted (Option A). Clicking
    // opens its plain-English copy below the row.
    const chip = screen.getByRole('button', { name: /Prompt injection/ })
    expect(chip).toHaveAttribute('data-caution', 'true')
    fireEvent.click(chip)
    expect(screen.getByText(/hijack an agent/)).toBeInTheDocument()
    // Never the raw id.
    expect(screen.queryByText(/^injection$/)).not.toBeInTheDocument()
  })

  it('a sub-serious content chip renders plain-English copy, never the machine rule tag', () => {
    const findings: SecurityFinding[] = [
      // `why` is a machine rule tag (no spaces) — it must not be rendered.
      { category: 'obfuscation', confidence: 'medium', file: 'a.js', line: 5, why: 'obfuscation:base64-blob' },
    ]
    render(<TrustPanel capabilities={null} findings={findings} analysis="full" />)
    fireEvent.click(screen.getByRole('button', { name: /Hard-to-read code/ }))
    expect(screen.getByText(/Encoded or scrambled/)).toBeInTheDocument()
    expect(screen.queryByText('obfuscation:base64-blob')).not.toBeInTheDocument()
  })

  // --- AE4: only sub-serious findings → no Safety card ----------------------

  it('AE4: a skill with only low/medium findings shows no Safety card', () => {
    const findings: SecurityFinding[] = [
      { category: 'exfil', confidence: 'low', file: 'a.sh', line: 1, why: 'x.' },
      { category: 'injection', confidence: 'medium', file: 'b.md', line: 2, why: 'y.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={null} findings={findings} analysis="full" />,
    )
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
    expect(screen.queryByText('Safety')).not.toBeInTheDocument()
    // The sub-serious findings inform as chips; no "nothing serious" footer.
    expect(screen.getByRole('button', { name: /Send data out/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Prompt injection/ })).toBeInTheDocument()
    expect(screen.queryByText(/nothing serious/)).not.toBeInTheDocument()
  })

  // --- Serious (high-confidence) → red Safety card, non-blocking ------------

  it('AE1-serious: a high-confidence finding reads "Serious — <concern>", red, and never says blocked', () => {
    const findings: SecurityFinding[] = [
      { category: 'risky-call', confidence: 'high', file: 'run.sh', line: 1, why: 'High-confidence.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={null} findings={findings} analysis="full" />,
    )
    expect(screen.getByText('Safety')).toBeInTheDocument()
    const verdict = screen.getByRole('button', { name: /Serious: Run a shell command/ })
    expect(verdict).toHaveAttribute('data-status', 'serious')
    // Non-blocking is explicit, and "Blocked" never appears.
    expect(screen.getByText(/doesn.t block the install/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('Blocked')
  })

  // --- Registry quarantined is authoritative (serious tier) -----------------

  it('a quarantined registry status reads Serious even when its served finding is only medium', () => {
    const findings: SecurityFinding[] = [
      { category: 'injection', confidence: 'medium', file: 'SKILL.md', line: 3, why: 'Redirects the agent.' },
    ]
    render(
      <TrustPanel capabilities={null} findings={findings} analysis="full" status="quarantined" />,
    )
    const verdict = screen.getByRole('button', { name: /Serious: Prompt injection/ })
    expect(verdict).toHaveAttribute('data-status', 'serious')
    // Promoted to Safety, NOT demoted to the also-noticed note.
    expect(screen.queryByText(/Also noticed/)).not.toBeInTheDocument()
  })

  it('a quarantined status reads Serious even with no served findings (withheld secrets)', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('fetch.ts', 3)] },
    ]
    const { container } = render(
      <TrustPanel capabilities={capabilities} analysis="full" status="quarantined" />,
    )
    expect(screen.getByText(/Serious: review carefully/)).toBeInTheDocument()
    expect(container.querySelector('[data-status="serious"]')).not.toBeNull()
    expect(screen.queryByText(/nothing concerning/)).not.toBeInTheDocument()
  })

  it('a quarantined skill with no capabilities, findings, or blind spots still shows the Safety card (never renders benign)', () => {
    // The trust-failure case: registry condemned the skill but served no data
    // (withheld secrets, no computed caps). It must NOT fall through to the inert
    // "Just instructions" line or render nothing.
    const { container } = render(
      <TrustPanel capabilities={[]} analysis="full" status="quarantined" />,
    )
    expect(container.querySelector('[data-status="serious"]')).not.toBeNull()
    expect(screen.getByText(/Serious: review carefully/)).toBeInTheDocument()
    expect(screen.queryByText(/Just instructions/)).not.toBeInTheDocument()
  })

  it('renders the Safety card for a quarantined skill even when capabilities were never computed (null)', () => {
    const { container } = render(<TrustPanel capabilities={null} status="quarantined" />)
    // The null-capabilities early return must not swallow a quarantine verdict.
    expect(container).not.toBeEmptyDOMElement()
    expect(container.querySelector('[data-status="serious"]')).not.toBeNull()
  })

  it('escapes markup in a content-finding chip (no injection in the chip detail)', () => {
    const malicious = '<img src=x onerror=alert(1)>.md'
    const findings: SecurityFinding[] = [
      {
        category: 'injection',
        confidence: 'medium',
        file: malicious,
        line: 2,
        why: 'Redirects the agent.',
        snippet: '<script>alert(1)</script>',
      },
    ]
    const { container } = render(
      <TrustPanel capabilities={null} analysis="full" findings={findings} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Prompt injection/ }))
    // The crafted path and snippet render as text, never as live DOM nodes.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getAllByText(malicious).length).toBeGreaterThan(0)
  })

  it('a sub-serious action finding whose tagged capability is absent falls back to its own standalone row', () => {
    // destructive is tagged deletes-files, but no deletes-files capability is
    // present → it must NOT vanish; it becomes its own calm row (the
    // foldedByCap -> standaloneByCat fallback).
    const findings: SecurityFinding[] = [
      { category: 'destructive', confidence: 'medium', file: 'x.sh', line: 3, why: 'rm.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={[]} analysis="full" findings={findings} />,
    )
    const row = screen.getByRole('button', { name: /Delete or overwrite files/ })
    // A standalone flagged finding is caution-tinted (Option A).
    expect(row).toHaveAttribute('data-caution', 'true')
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
    fireEvent.click(row)
    expect(screen.getByRole('button', { name: 'x.sh:3' })).toBeInTheDocument()
  })

  it('an unknown-category sub-serious finding becomes a chip (findingShape content-default), not Safety', () => {
    const findings: SecurityFinding[] = [
      { category: 'future-unknown', confidence: 'medium', file: 'a.md', line: 1, why: 'x.' },
    ]
    const { container } = render(
      <TrustPanel capabilities={null} analysis="full" findings={findings} />,
    )
    // Humanized label from findingCategory's fallback, in the chip list.
    expect(screen.getByText('Permissions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Future Unknown/ })).toBeInTheDocument()
    expect(container.querySelector('[data-status="serious"]')).toBeNull()
  })

  it('aggregate: a serious member and a sub-serious member render the Safety card AND a chip, no quiet line', () => {
    const findings: SecurityFinding[] = [
      { category: 'exfil', confidence: 'high', file: 'a.sh', line: 1, why: 'out.', skill: { author: 'ann', slug: 'bad' } },
      { category: 'injection', confidence: 'medium', file: 'b.md', line: 2, why: 'inj.', snippet: 'x', skill: { author: 'bob', slug: 'mid' } },
    ]
    const { container } = render(
      <TrustPanel capabilities={[]} analysis="full" findings={findings} aggregate />,
    )
    expect(container.querySelector('[data-status="serious"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Prompt injection/ })).toBeInTheDocument()
    // The quiet acknowledgement is suppressed when serious.
    expect(screen.queryByText(/Scanned . nothing/)).not.toBeInTheDocument()
  })

  it('a flagged status with no served findings does not read the green "nothing concerning" line', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('fetch.ts', 3)] },
    ]
    const { container } = render(
      <TrustPanel capabilities={capabilities} analysis="full" status="flagged" />,
    )
    expect(screen.queryByText(/nothing concerning/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no serious findings/)).not.toBeInTheDocument()
    expect(container.querySelector('[data-status="clean"]')).toBeNull()
  })

  // --- A high-confidence tagged finding draws the eye to Safety -------------

  it('a high-confidence tagged finding marks its permission AND surfaces in the Safety card', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'deletes-files', risky: false, evidence: [ev('wipe.sh', 4)] },
    ]
    const findings: SecurityFinding[] = [
      { category: 'destructive', confidence: 'high', file: 'wipe.sh', line: 4, why: 'rm -rf /.' },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" findings={findings} />)
    // The permission row gets the "look at Safety" marker for the HIGH finding.
    expect(screen.getByRole('button', { name: /Delete files/ })).toHaveAttribute(
      'data-caution',
      'true',
    )
    // ...and the finding lives in the red Safety card, not folded silently.
    expect(screen.getByRole('button', { name: /Serious: Delete or overwrite files/ })).toBeInTheDocument()
  })

  // --- Permissions card structure ------------------------------------------

  it('shows only used capabilities (no "not used" rows) and never the word safe', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('fetch.ts', 3)] },
    ]
    const { container } = render(<TrustPanel capabilities={capabilities} analysis="full" />)
    expect(screen.getByText('Use the internet')).toBeInTheDocument()
    expect(screen.queryByText('Delete files')).not.toBeInTheDocument()
    expect(screen.queryByText(/not used/)).not.toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toMatch(/\bsafe\b/)
  })

  it('renders the inert calm line (no card, no buttons) for an empty full scan', () => {
    render(<TrustPanel capabilities={[]} analysis="full" />)
    expect(
      screen.getByText('Just instructions. No commands, network, or file access.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Safety')).not.toBeInTheDocument()
  })

  it('renders nothing for null capabilities and no findings', () => {
    const { container } = render(<TrustPanel capabilities={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('escapes markup in capability evidence (no injection)', () => {
    const malicious = '<img src=x onerror=alert(1)>.sh'
    const capabilities: SkillCapability[] = [
      { capability: 'runs-shell', risky: false, evidence: [ev(malicious, 5)] },
    ]
    const { container } = render(<TrustPanel capabilities={capabilities} analysis="full" />)
    openRow(/Run commands/)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(malicious)).toBeInTheDocument()
  })

  // --- Partial-scan honesty -------------------------------------------------

  it('shows a generic incomplete note when partial with no file list and no named unscanned skills', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'runs-shell', risky: false, evidence: [ev('run.sh', 2)] },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="partial" />)
    expect(
      screen.getByText(/This may be incomplete, since not everything could be scanned/),
    ).toBeInTheDocument()
    // Never claims files were unreadable when we don't know that.
    expect(screen.queryByText(/files couldn.t be scanned/)).not.toBeInTheDocument()
  })

  it('names the not-yet-scanned member skills (kit) instead of implying unreadable files', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'runs-shell', risky: false, evidence: [ev('run.sh', 2)] },
    ]
    render(
      <TrustPanel
        capabilities={capabilities}
        analysis="partial"
        aggregate
        unscannedSkills={[{ author: 'k-dense-ai', slug: 'arboreto' }]}
      />,
    )
    // Collapsed by default: the count is the line, the list is one click away.
    expect(screen.getByText('1 skill not yet scanned')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /k-dense-ai\/arboreto/ })).not.toBeInTheDocument()
    openRow(/1 skill not yet scanned/)
    const link = screen.getByRole('link', { name: /k-dense-ai\/arboreto/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('arboreto'))
    expect(screen.queryByText(/files couldn.t be scanned/)).not.toBeInTheDocument()
  })

  it('kit: members with no installable version read as held, never "not yet scanned"', () => {
    // Regression: a skill whose every version the scanner held resolves no hash,
    // so it fell into the unscanned bucket and the panel said the opposite of
    // what happened to it.
    render(
      <TrustPanel
        capabilities={[{ capability: 'runs-shell', risky: false, evidence: [ev('run.sh', 2)] }]}
        analysis="partial"
        aggregate
        unavailableSkills={[{ author: 'garrytan', slug: 'cso' }]}
      />,
    )
    expect(screen.getByText('1 skill with no installable version')).toBeInTheDocument()
    expect(screen.queryByText(/not yet scanned/)).not.toBeInTheDocument()
    openRow(/1 skill with no installable version/)
    expect(screen.getByRole('link', { name: /garrytan\/cso/ })).toBeInTheDocument()
  })

  it('lists unscanned files in the quiet honesty area; a file reveals in-viewer on a skill page', () => {
    const reveals = captureReveals()
    render(
      <TrustPanel
        capabilities={[]}
        analysis="partial"
        blindSpots={[{ file: 'setup.rb' }, { file: 'lib/x.go' }]}
      />,
    )
    // No redundant clean line; the unscanned list still shows directly.
    expect(screen.queryByText(/nothing concerning/)).not.toBeInTheDocument()
    expect(screen.getByText('2 unscanned files')).toBeInTheDocument()
    openRow(/2 unscanned files/)
    expect(screen.getByText('setup.rb')).toBeInTheDocument()
    expect(screen.getByText('lib/x.go')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open setup\.rb/ }))
    expect(reveals.events).toContainEqual({ path: 'setup.rb', line: 1 })
    reveals.stop()
  })

  it('no "Unscanned files" anywhere when there are no blind spots', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [ev('fetch.ts', 3)] },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" />)
    expect(screen.queryByText(/unscanned file/)).not.toBeInTheDocument()
  })

  // --- revealFinding deep-links (skill page) -------------------------------

  it('fires revealFinding for a capability evidence location', () => {
    const { events, stop } = captureReveals()
    const capabilities: SkillCapability[] = [
      { capability: 'deletes-files', risky: false, evidence: [ev('scripts/wipe.sh', 42)] },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" />)
    openRow(/Delete files/)
    fireEvent.click(screen.getByRole('button', { name: 'wipe.sh:42' }))
    expect(events).toEqual([{ path: 'scripts/wipe.sh', line: 42 }])
    stop()
  })

  it('fires revealFinding from a content-finding chip detail', () => {
    const { events, stop } = captureReveals()
    const findings: SecurityFinding[] = [
      { category: 'injection', confidence: 'medium', file: 'SKILL.md', line: 12, why: 'Redirects the agent.' },
    ]
    render(<TrustPanel capabilities={null} findings={findings} />)
    fireEvent.click(screen.getByRole('button', { name: /Prompt injection/ }))
    // Single skill: no member-skill attribution links.
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SKILL.md:12' }))
    expect(events).toEqual([{ path: 'SKILL.md', line: 12 }])
    stop()
  })

  // --- Aggregate (kit) mode -------------------------------------------------

  it('aggregate: a permission row lists its contributing member skills as links, no file evidence', () => {
    const capabilities: SkillCapability[] = [
      {
        capability: 'network',
        risky: true,
        evidence: [ev('phantom/SKILL.md', 42)],
        skills: [
          { author: 'ann', slug: 'sketchy', risky: true },
          { author: 'bob', slug: 'safe', risky: false },
        ],
      },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" aggregate />)
    openRow(/Use the internet/)

    const sketchy = screen.getByRole('link', { name: /@ann\/sketchy/ })
    expect(sketchy).toHaveAttribute('href', skillHref('ann', 'sketchy'))
    expect(screen.getByRole('link', { name: /@bob\/safe/ })).toHaveAttribute(
      'href',
      skillHref('bob', 'safe'),
    )
    // The risky contributor reads amber.
    expect(sketchy).toHaveClass('text-(--warning)')
    // Count is "N skills", never "N places", and no cross-skill file:line leaks.
    expect(screen.getByText(/2 skills/)).toBeInTheDocument()
    expect(screen.queryByText(/phantom\/SKILL\.md/)).not.toBeInTheDocument()
    expect(screen.queryByText(/place/)).not.toBeInTheDocument()
  })

  it('aggregate: a permission with no attributed skills shows its meaning, no empty box', () => {
    const capabilities: SkillCapability[] = [
      { capability: 'network', risky: false, evidence: [], skills: [] },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" aggregate />)
    openRow(/Use the internet/)
    expect(screen.getByText(/Connects to the internet/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ skill/)).not.toBeInTheDocument()
  })

  it('aggregate: a sub-serious content finding is a chip, attributed to its skill on expand', () => {
    const findings: SecurityFinding[] = [
      {
        category: 'injection',
        confidence: 'medium',
        file: 'references/codemode.md',
        line: 64,
        why: 'Tries to override the agent.',
        snippet: 'injection:fake-system-tag',
        skill: { author: 'ann', slug: 'sketchy' },
      },
    ]
    render(<TrustPanel capabilities={[]} analysis="full" findings={findings} aggregate />)
    fireEvent.click(screen.getByRole('button', { name: /Prompt injection/ }))

    // Attributed to its member skill...
    expect(screen.getByRole('link', { name: /@ann\/sketchy/ })).toHaveAttribute(
      'href',
      skillHref('ann', 'sketchy'),
    )
    // ...shows the actual flagged line under its filename header...
    expect(screen.getByText('injection:fake-system-tag')).toBeInTheDocument()
    expect(screen.getByText('references/codemode.md')).toBeInTheDocument()
    // ...the filename header deep-links into that skill's viewer...
    expect(screen.getByRole('link', { name: /Open references\/codemode\.md/ })).toHaveAttribute(
      'href',
      skillViewHref('ann', 'sketchy', 'references/codemode.md'),
    )
    // ...the flagged line deep-links to that exact line...
    expect(screen.getByRole('link', { name: 'codemode.md:64' })).toHaveAttribute(
      'href',
      skillViewHref('ann', 'sketchy', 'references/codemode.md', 64),
    )
    // ...and never the skill-page-only "Report this skill" footer.
    expect(screen.queryByText(/Report this skill/)).not.toBeInTheDocument()
  })

  it('aggregate: a withheld-snippet SERIOUS warning shows skill + file:line, no empty code box', () => {
    const findings: SecurityFinding[] = [
      {
        category: 'exfil',
        confidence: 'high',
        file: 'run.sh',
        line: 1,
        why: 'Pipes data out.',
        skill: { author: 'ann', slug: 'sketchy' },
      },
    ]
    render(<TrustPanel capabilities={[]} analysis="full" findings={findings} aggregate />)
    fireEvent.click(screen.getByRole('button', { name: /Serious: Send data out/ }))
    expect(screen.getByRole('link', { name: /@ann\/sketchy/ })).toBeInTheDocument()
    expect(screen.getByText('run.sh')).toBeInTheDocument()
    expect(screen.getByText('Pipes data out.')).toBeInTheDocument()
  })

  it('aggregate: groups a sub-serious content category by its two source skills', () => {
    const findings: SecurityFinding[] = [
      {
        category: 'injection',
        confidence: 'low',
        file: 'a.md',
        line: 1,
        why: 'x y',
        snippet: 'one',
        skill: { author: 'ann', slug: 'one' },
      },
      {
        category: 'injection',
        confidence: 'low',
        file: 'b.md',
        line: 2,
        why: 'y z',
        snippet: 'two',
        skill: { author: 'bob', slug: 'two' },
      },
    ]
    render(<TrustPanel capabilities={[]} analysis="full" findings={findings} aggregate />)
    fireEvent.click(screen.getByRole('button', { name: /Prompt injection/ }))
    expect(screen.getByRole('link', { name: /@ann\/one/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /@bob\/two/ })).toBeInTheDocument()
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
  })

  it('aggregate: a sub-serious tagged action finding folds into its permission row WITHOUT a marker', () => {
    const capabilities: SkillCapability[] = [
      {
        capability: 'runs-shell',
        risky: false,
        evidence: [ev('scripts/run.sh', 3)],
        skills: [{ author: 'cloudflare', slug: 'skills', risky: false }],
      },
    ]
    const findings: SecurityFinding[] = [
      {
        // risky-call (medium, action) is tagged runs-shell → folds in, neutral.
        category: 'risky-call',
        confidence: 'medium',
        file: 'scripts/run.sh',
        line: 3,
        why: 'Runs a subprocess from input.',
        snippet: 'exec(userInput)',
        skill: { author: 'cloudflare', slug: 'skills' },
      },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" findings={findings} aggregate />)

    // The permission row is NOT marked for a sub-serious finding.
    expect(screen.getByRole('button', { name: /Run commands/ })).toHaveAttribute(
      'data-caution',
      'false',
    )
    // No red Safety card.
    expect(screen.queryByText('Safety')).not.toBeInTheDocument()

    // The folded snippet + file + member link live under the open row.
    openRow(/Run commands/)
    expect(screen.getByText('exec(userInput)')).toBeInTheDocument()
    expect(screen.getByText('scripts/run.sh')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /@cloudflare\/skills/ })).toHaveAttribute(
      'href',
      skillHref('cloudflare', 'skills'),
    )
  })

  it('aggregate: a benign permission shows only its contributing skills, no snippet box', () => {
    const capabilities: SkillCapability[] = [
      {
        capability: 'network',
        risky: false,
        evidence: [ev('SKILL.md', 1)],
        skills: [{ author: 'bob', slug: 'safe', risky: false }],
      },
    ]
    render(<TrustPanel capabilities={capabilities} analysis="full" aggregate />)
    openRow(/Use the internet/)
    expect(screen.getByRole('link', { name: /@bob\/safe/ })).toBeInTheDocument()
    // No flag → no evidence container (no cross-skill file:line), just the link.
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument()
  })

  it('aggregate: groups unscanned files by member skill and deep-links each', () => {
    render(
      <TrustPanel
        capabilities={[]}
        analysis="partial"
        aggregate
        blindSpots={[
          { file: 'setup.rb', skill: { author: 'ann', slug: 'one' } },
          { file: 'x.go', skill: { author: 'bob', slug: 'two' } },
        ]}
      />,
    )
    // Unscanned files sit behind the one-line count in the quiet honesty area.
    openRow(/2 unscanned files/)
    expect(screen.getByRole('link', { name: /@ann\/one/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'setup.rb' })).toHaveAttribute(
      'href',
      skillViewHref('ann', 'one', 'setup.rb'),
    )
    expect(screen.getByRole('link', { name: 'x.go' })).toHaveAttribute(
      'href',
      skillViewHref('bob', 'two', 'x.go'),
    )
  })
})
