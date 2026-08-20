import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ClaimMirrorCta,
  ClaimResultNotice,
  parseClaimResult,
} from '@/components/mirror-notice'

// AppLink routes internal hrefs through next/link; stub it to a plain anchor so
// href assertions work the same for internal, /api/*, and external links.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('ClaimMirrorCta', () => {
  it('links an authed viewer straight into the read:org grant, owning it as an org', () => {
    render(<ClaimMirrorCta handle="vercel" authed sourceOwnerType="Organization" />)
    expect(screen.getByRole('link', { name: 'Claim @vercel' })).toHaveAttribute(
      'href',
      '/api/github/claim-org/start?handle=vercel',
    )
    // The unified model: you own it as an org; your own handle stays yours.
    expect(screen.getByText(/own it as an organization/i)).toBeInTheDocument()
  })

  it('omits the personal-account line for an Organization source (authed)', () => {
    render(<ClaimMirrorCta handle="vercel" authed sourceOwnerType="Organization" />)
    expect(screen.queryByText(/personal account/i)).not.toBeInTheDocument()
  })

  it('offers the personal-account path for a User source (authed)', () => {
    render(<ClaimMirrorCta handle="maya" authed sourceOwnerType="User" />)
    expect(screen.getByRole('link', { name: 'Claim @maya' })).toHaveAttribute(
      'href',
      '/api/github/claim-org/start?handle=maya',
    )
    expect(screen.getByText(/own it as an organization/i)).toBeInTheDocument()
    // A User source also surfaces the (follow-up) personal-account path.
    expect(screen.getByText(/personal account/i)).toBeInTheDocument()
  })

  it('routes an unauthed Organization-source viewer to login', () => {
    render(<ClaimMirrorCta handle="vercel" authed={false} sourceOwnerType="Organization" />)
    expect(screen.getByRole('link', { name: 'Log in to claim @vercel' })).toHaveAttribute(
      'href',
      '/login?callbackUrl=%2Fvercel',
    )
  })

  it('sends an unauthed User-source viewer straight into the account-bootstrap grant', () => {
    render(<ClaimMirrorCta handle="maya" authed={false} sourceOwnerType="User" />)
    // Primary action: the GitHub grant (mints an account at @handle), NOT login.
    expect(screen.getByRole('link', { name: 'Claim @maya' })).toHaveAttribute(
      'href',
      '/api/github/claim-org/start?handle=maya',
    )
    expect(screen.getByText(/sign in with github to claim it as your account/i)).toBeInTheDocument()
    // Secondary: existing-account holders can log in to own it as an org.
    expect(
      screen.getByRole('link', { name: /have an account\? log in to own it as an organization/i }),
    ).toHaveAttribute('href', '/login?callbackUrl=%2Fmaya')
  })

  it('shows a static "Claimed" label, not the CTA, for a claimed brand', () => {
    render(<ClaimMirrorCta handle="vercel" claimed />)
    expect(screen.getByText('Claimed')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /claim @vercel/i })).not.toBeInTheDocument()
  })
})

describe('ClaimResultNotice', () => {
  it('confirms the claim on ELIGIBLE', () => {
    render(<ClaimResultNotice result={{ classification: 'ELIGIBLE', handle: 'vercel', claimed: true }} />)
    expect(screen.getByText(/You now manage @vercel/)).toBeInTheDocument()
  })

  it('renders the contributor-denied copy on NOT_ELIGIBLE', () => {
    render(<ClaimResultNotice result={{ classification: 'NOT_ELIGIBLE', handle: 'vercel' }} />)
    expect(screen.getByText(/org owner or repo admin/i)).toBeInTheDocument()
    // A clean denial, never a flat "couldn't verify".
    expect(screen.queryByRole('link', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('renders org-policy remediation + a working "Try again" on INDETERMINATE (Organization source)', () => {
    render(<ClaimResultNotice result={{ classification: 'INDETERMINATE', handle: 'vercel', ownerType: 'Organization' }} />)
    expect(screen.getByRole('link', { name: /approve skillet in your org settings/i })).toHaveAttribute(
      'href',
      'https://github.com/orgs/vercel/settings/oauth_application_policy',
    )
    expect(screen.getByRole('link', { name: /try again/i })).toHaveAttribute(
      'href',
      '/api/github/claim-org/start?handle=vercel',
    )
  })

  it('omits the org-OAuth-policy link for a User source INDETERMINATE (no org settings page)', () => {
    render(<ClaimResultNotice result={{ classification: 'INDETERMINATE', handle: 'maya', ownerType: 'User' }} />)
    // Generic "try again", but never the org settings link that would 404 for a User.
    expect(screen.queryByRole('link', { name: /approve skillet in your org settings/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /try again/i })).toHaveAttribute(
      'href',
      '/api/github/claim-org/start?handle=maya',
    )
  })

  it('renders "already managed" (not "you now manage") on ALREADY_MANAGED', () => {
    render(<ClaimResultNotice result={{ classification: 'ALREADY_MANAGED', handle: 'vercel', claimed: false }} />)
    expect(screen.getByText(/already managed by its owner/i)).toBeInTheDocument()
    expect(screen.queryByText(/you now manage/i)).not.toBeInTheDocument()
  })

  it('renders an accurate, non-retry message on DENIED (no org-policy link, no try again)', () => {
    render(<ClaimResultNotice result={{ classification: 'DENIED', handle: 'vercel' }} />)
    expect(screen.getByText(/couldn’t complete the claim/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /approve skillet in your org settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /try again/i })).not.toBeInTheDocument()
  })
})

describe('parseClaimResult', () => {
  it('parses the structured cookie value', () => {
    expect(parseClaimResult(JSON.stringify({ classification: 'ELIGIBLE', handle: 'vercel', claimed: true }))).toEqual(
      { classification: 'ELIGIBLE', handle: 'vercel', claimed: true, ownerType: null },
    )
  })

  it('carries ownerType through (gates the INDETERMINATE org-policy remediation)', () => {
    expect(
      parseClaimResult(JSON.stringify({ classification: 'INDETERMINATE', handle: 'maya', ownerType: 'User' })),
    ).toEqual({ classification: 'INDETERMINATE', handle: 'maya', claimed: false, ownerType: 'User' })
  })

  it('rejects anything not produced by the callback cookie (no URL-flippable result)', () => {
    // A bare URL-style value or an unknown classification yields nothing — the
    // outcome can only come from the server-set cookie's JSON shape.
    expect(parseClaimResult('claimed')).toBeNull()
    expect(parseClaimResult(JSON.stringify({ classification: 'ADMIN', handle: 'vercel' }))).toBeNull()
    expect(parseClaimResult(JSON.stringify({ classification: 'ELIGIBLE' }))).toBeNull()
    expect(parseClaimResult(null)).toBeNull()
    expect(parseClaimResult(undefined)).toBeNull()
  })
})
