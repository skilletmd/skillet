import Link from 'next/link'

const TOOLS = [
  {
    href: '/lab/design',
    title: 'Design system',
    desc: 'Color tokens, type scale, and component gallery.',
  },
  {
    href: '/lab/og',
    title: 'OG cards',
    desc: 'Social share cards for every page type, previewed as they look on X.',
  },
  {
    href: '/lab/covers',
    title: 'Covers',
    desc: 'The production cover engine across a spread of kits and single skills.',
  },
  {
    href: '/lab/icons',
    title: 'Category icons',
    desc: 'A line-drawn glyph for every browse category, on its swatch and in ink.',
  },
  {
    href: '/lab/cover-experiments',
    title: 'Cover experiments',
    desc: 'The painted cover system with its full design trail: gradation rolls, category waves, screens, marks.',
  },
  {
    href: '/lab/avatars',
    title: 'Avatars',
    desc: 'The default avatar set and fallbacks.',
  },
  {
    href: '/lab/illustrations',
    title: 'Illustrations',
    desc: 'Every illustration in one place — docs header art and empty states, numbered.',
  },
  {
    href: '/lab/scanner',
    title: 'Scanner vocabulary',
    desc: 'Every label, describe, and fix the scanner shows — audited for consistency and cross-referenced to the detectors.',
  },
]

export default function LabHub() {
  return (
    <main style={{ maxWidth: 1320, margin: '0 auto', padding: '40px 20px 80px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>Lab</h1>
      <p style={{ marginTop: 8, color: 'var(--ink-2)', fontSize: 15 }}>
        Design and dev tooling. Not indexed, not part of the product surface.
      </p>
      <div
        style={{
          marginTop: 28,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}
      >
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              display: 'block',
              border: '1px solid var(--line)',
              borderRadius: 14,
              background: 'var(--surface)',
              padding: '18px 20px',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{t.title}</div>
            <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.4 }}>
              {t.desc}
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
