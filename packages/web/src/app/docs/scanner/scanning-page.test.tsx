import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FLAGS, PERMISSIONS } from '@skillet/protocol'
import ScanningDoc from './page'

afterEach(cleanup)

describe('docs /reference/scanning page', () => {
  // Loads for a logged-out visitor (pure server component, no auth) and shows the
  // scanning explanation + the permissions and flags tables, live from the vocab.
  it('renders the scanning explanation with the false-positive caveat', () => {
    render(<ScanningDoc />)
    expect(screen.getByRole('heading', { name: /How Skillet scans a skill/ })).toBeInTheDocument()
    expect(screen.getByText(/false positives are common/)).toBeInTheDocument()
    expect(screen.getByText(/never blocks an install/)).toBeInTheDocument()
  })

  it('teaches the two zones', () => {
    render(<ScanningDoc />)
    // getAll: the footer's Safety-doc link shares the zone label's text.
    expect(screen.getAllByText('Safety').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Permissions').length).toBeGreaterThan(0)
    expect(screen.queryByText('Also noticed')).not.toBeInTheDocument()
  })

  it('lists every permission label', () => {
    render(<ScanningDoc />)
    for (const p of Object.values(PERMISSIONS)) {
      expect(screen.getAllByText(p.label).length).toBeGreaterThan(0)
    }
  })

  it('lists every flag label', () => {
    render(<ScanningDoc />)
    for (const f of Object.values(FLAGS)) {
      expect(screen.getAllByText(f.label).length).toBeGreaterThan(0)
    }
  })

  it('does not leak author-facing fix copy or detector internals', () => {
    const { container } = render(<ScanningDoc />)
    expect(container.textContent).not.toContain(FLAGS.exfil.fix)
    expect(container.textContent).not.toContain('detector')
  })
})
