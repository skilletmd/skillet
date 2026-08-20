import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsSection } from './setting-section'

describe('SettingsSection', () => {
  it('renders the title in an h2', () => {
    render(<SettingsSection title="Connected devices" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Connected devices')
  })

  it('renders the description when provided and omits it otherwise', () => {
    const { rerender } = render(
      <SettingsSection title="Updates" description="How updates reach your devices." />,
    )
    expect(screen.getByText('How updates reach your devices.')).toBeInTheDocument()
    rerender(<SettingsSection title="Updates" />)
    expect(screen.queryByText('How updates reach your devices.')).not.toBeInTheDocument()
  })

  it('renders the action node on the title row', () => {
    render(<SettingsSection title="Profile" action={<button type="button">View profile</button>} />)
    expect(screen.getByRole('button', { name: 'View profile' })).toBeInTheDocument()
  })

  it('renders children in the body', () => {
    render(
      <SettingsSection title="Section">
        <p>body content</p>
      </SettingsSection>,
    )
    expect(screen.getByText('body content')).toBeInTheDocument()
  })
})
