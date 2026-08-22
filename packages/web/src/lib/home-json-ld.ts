/**
 * The homepage's structured data: an Organization node and a WebSite node in
 * one graph.
 *
 * Lifted out of the page module so it can be unit-tested — a page component is
 * the wrong home for sixty lines of JSON-LD, and the graph is easy to break in
 * ways nothing else notices.
 *
 * No `address`. Schema audits score its absence, and the fix is a PostalAddress
 * — which this project does not have and will not invent. A fabricated address
 * on a business record is worse than a missing one.
 */
import { GITHUB_REPO_URL } from './urls'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

/** Public support address for structured data. Unset by default — see the
 *  contactPoint note below. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null

// Organization + WebSite in one graph. The SearchAction is what makes Google
// eligible to show a sitelinks search box for the brand query, and the
// Organization node is what feeds the knowledge panel / AI-answer attribution.
export const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'Skillet',
      url: SITE_URL,
      logo: `${SITE_URL}/brand/skillet-mascot-logo.png`,
      description:
        'A registry for agent skills: publish a skill once, run it in every agent runtime.',
      sameAs: [GITHUB_REPO_URL],
      // How to reach a human, in the field AI answer engines read to verify a
      // business is real. `email` is opt-in via NEXT_PUBLIC_CONTACT_EMAIL: the
      // rest of the site renders addresses through ObfuscatedEmail on purpose,
      // so publishing one into structured data has to be a deliberate choice,
      // not a side effect of adding schema.
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          url: `${SITE_URL}/contact`,
          availableLanguage: ['English'],
          ...(CONTACT_EMAIL ? { email: CONTACT_EMAIL } : {}),
        },
        {
          '@type': 'ContactPoint',
          contactType: 'technical support',
          url: `${GITHUB_REPO_URL}/issues`,
          availableLanguage: ['English'],
        },
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'Skillet',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

