import type { Metadata } from 'next'
import { ObfuscatedEmail } from '@/components/obfuscated-email'

export const metadata: Metadata = {
  title: 'Copyright / DMCA Policy',
  description: 'How to report copyright infringement and file a counter-notice.',
}

// Public copyright policy. The in-app "Report → copyright / takedown" flow is a
// good-faith fast path; this page is the formal channel (designated agent,
// sworn notice, counter-notice). Keep this in sync with
// docs/legal/dmca-policy.md.
export default function DmcaPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-(--ink-2)">
      <h1 className="text-2xl font-semibold text-(--ink)">Copyright / DMCA Policy</h1>
      <p className="mt-2 text-sm text-(--ink-3)">
        Draft — not legal advice. Skillet is an independent project, not a company; notices go to
        the email below.
      </p>

      <p className="mt-6">
        We respect copyright and respond to clear notices of alleged infringement that comply with
        the U.S. Digital Millennium Copyright Act (DMCA). We terminate repeat infringers.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Reporting infringement</h2>
      <p className="mt-2">Send a written notice to the email below that includes:</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Your physical or electronic signature.</li>
        <li>Identification of the copyrighted work you claim was infringed.</li>
        <li>The skill URL and author handle so we can locate the material.</li>
        <li>Your contact information (name, address, email, phone).</li>
        <li>
          A statement that you have a good-faith belief the use is not authorized by the owner,
          its agent, or the law.
        </li>
        <li>
          A statement, under penalty of perjury, that the notice is accurate and that you are the
          owner or authorized to act on its behalf.
        </li>
      </ol>
      <p className="mt-3">
        <span className="font-medium text-(--ink)">Send notices to:</span>{' '}
        <ObfuscatedEmail user="skilletdotmd" domain="gmail.com" subject="DMCA notice" />
      </p>
      <p className="mt-2 text-sm text-(--ink-3)">
        Knowingly misrepresenting that material is infringing can expose you to liability under 17
        U.S.C. § 512(f).
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Counter-notification</h2>
      <p className="mt-2">
        If your content was removed by mistake or misidentification, you may send a counter-notice
        to the address above. On a valid counter-notice we may restore the material in 10–14
        business days unless the complainant files a court action.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Mirrored content</h2>
      <p className="mt-2">
        For content we mirror from GitHub, the fastest remedy is often to change or remove the
        license or skill at the source — the mirror follows it.
      </p>
    </main>
  )
}
