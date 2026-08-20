'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

const STYLES = [
  { value: 'button' as const, label: 'Button', height: 28 },
  { value: 'flat' as const, label: 'Flat', height: 20 },
]

/**
 * Owner-only README badge for the author's repo. The badge links back here, so
 * anyone reading that repo can add the kit (or skill) in one click. Compact:
 * both styles previewed, each with a Markdown / HTML copy — no picker UI.
 */
export function BadgeSnippet({
  badgePath,
  targetUrl,
  alt,
}: {
  /** Origin-qualified base, e.g. https://skillet.md/api/badge/kit/<id> */
  badgePath: string
  /** Origin-qualified page the badge links to. */
  targetUrl: string
  /** Image alt text, e.g. "Test Skills on Skillet". */
  alt: string
}) {
  // The hook owns a single boolean; we track which button it belongs to so only
  // that button flips to "Copied". Once the hook resets `copied` to false, the
  // gated condition below clears regardless of the stale key.
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const { copied, copy: copyText } = useCopyToClipboard()

  function copy(text: string, key: string) {
    setCopiedKey(key)
    void copyText(text)
  }

  return (
    <section aria-label="README badge">
      <Eyebrow>Readme badge</Eyebrow>
      <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
        Drop one in your repo. Anyone who sees it can add it in one click.
      </p>
      <div className="mt-4 space-y-4">
        {STYLES.map((s) => {
          const badgeUrl = s.value === 'button' ? `${badgePath}?style=button` : badgePath
          const md = `[![${alt}](${badgeUrl})](${targetUrl})`
          const html = `<a href="${targetUrl}"><img src="${badgeUrl}" alt="${alt}" height="${s.height}"></a>`
          return (
            <div key={s.value}>
              <a
                href={targetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block"
                aria-label={`${s.label} badge preview`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={badgeUrl} alt={alt} style={{ height: s.height }} />
              </a>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton
                  label="Copy MD"
                  copied={copied && copiedKey === `${s.value}-md`}
                  onClick={() => copy(md, `${s.value}-md`)}
                />
                <CopyButton
                  label="Copy HTML"
                  copied={copied && copiedKey === `${s.value}-html`}
                  onClick={() => copy(html, `${s.value}-html`)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CopyButton({
  label,
  copied,
  onClick,
}: {
  label: string
  copied: boolean
  onClick: () => void
}) {
  return (
    <Button variant="secondary" size="sm" type="button" onClick={onClick}>
      {copied ? 'Copied' : label}
    </Button>
  )
}
