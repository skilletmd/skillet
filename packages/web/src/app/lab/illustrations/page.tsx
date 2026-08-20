import fs from 'node:fs'
import path from 'node:path'

export const metadata = {
  title: 'Illustrations — Skillet',
  robots: { index: false },
}

type Shot = {
  n: number
  file: string
  url: string
  /** where the illustration is used, or null if it's on disk but unreferenced */
  usage: string | null
}

/** Filename → where it's used in the product. Keeps the gallery honest about
 *  what's live vs. orphaned. Anything on disk but missing here renders as an
 *  unused orphan. */
const USAGE: Record<string, string> = {
  // docs headers + inline body art
  'what-is-skillet.png': 'Docs home header',
  'install.png': 'Install page header',
  'concepts.png': 'Skills & kits header',
  'concepts-verbs.png': 'Skills & kits, inline',
  'publish.png': 'Publish page header',
  'skill-format.png': 'SKILL.md page header',
  'mcp.png': 'MCP page header',
  'trust-and-safety.png': 'Safety page header',
  'follow-and-subscribe.png': 'Add skills header',
  'updates.png': 'Updates page header',
  'updates-diff.png': 'Updates page, inline',
  'faq.png': 'FAQ page header',
  'teams.png': 'Teams page header',
  'teams-key.png': 'Teams page, inline',
  'cli.png': 'CLI page header',
  'rt-chatgpt.png': 'Runtime: ChatGPT',
  'rt-claude.png': 'Runtime: Claude',
  'rt-claude-ai.png': 'Runtime: Claude.ai + Desktop',
  'rt-codex.png': 'Runtime: Codex',
  'rt-cursor.png': 'Runtime: Cursor',
  'rt-devin.png': 'Runtime: Devin',
  'rt-hermes.png': 'Runtime: Hermes',
  'rt-openclaw.png': 'Runtime: OpenClaw',
  'rt-windsurf.png': 'Runtime: Windsurf',
  // empty states
  'empty-github.png': 'Settings → GitHub, not connected',
  'empty-feed.png': 'For-You feed, empty',
  'empty-notifications.png': 'Notifications, empty',
  'empty-devices.png': 'Connected devices, empty',
  'empty-teams.png': 'Teams manager, empty',
  'empty-updates.png': 'Updates list, empty',
}

type Group = {
  key: string
  title: string
  desc: string
  /** public/<dir> the images are read from */
  dir: string
  /** dark checkerboard behind transparent PNGs so the art reads on any theme */
  transparent: boolean
}

const GROUPS: Group[] = [
  {
    key: 'docs',
    title: 'Docs',
    desc: 'Header art on the documentation pages. Transparent PNGs served from /docs.',
    dir: 'docs',
    transparent: true,
  },
  {
    key: 'empty',
    title: 'Empty states',
    desc: 'Illustrations shown in empty states across the app. Served from /illustrations.',
    dir: 'illustrations',
    transparent: false,
  },
]

/** Read one public/<dir>, return its images sorted by filename. Numbering is
 *  assigned by the caller so it runs continuously across every group. */
function readGroup(dir: string, start: number): Shot[] {
  const abs = path.join(process.cwd(), 'public', dir)
  let files: string[] = []
  try {
    files = fs.readdirSync(abs)
  } catch {
    return []
  }
  return files
    .filter((f) => /\.(png|jpe?g|svg|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((file, i) => ({
      n: start + i,
      file,
      url: `/${dir}/${file}`,
      usage: USAGE[file] ?? null,
    }))
}

export default function IllustrationsPage() {
  let cursor = 1
  const groups = GROUPS.map((g) => {
    const shots = readGroup(g.dir, cursor)
    cursor += shots.length
    return { ...g, shots }
  })
  const total = cursor - 1

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">Illustrations</h1>
      <p className="mt-1 text-sm text-(--ink-2)">
        Every illustration in the product — {total} total, numbered continuously so any one is easy
        to point at. The big number is its reference; the filename is underneath.
      </p>

      {groups.map((g) => (
        <section key={g.key} className="mt-12">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-(--ink)">{g.title}</h2>
            <span className="font-mono text-xs text-(--ink-2)">{g.shots.length}</span>
          </div>
          <p className="mt-1 text-sm text-(--ink-2)">{g.desc}</p>

          {g.shots.length === 0 ? (
            <p className="mt-4 text-sm text-(--ink-2)">No images found in /{g.dir}.</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
              {g.shots.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col gap-2 no-underline"
                >
                  <div
                    className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-(--line)"
                    style={
                      g.transparent
                        ? {
                            backgroundColor: '#1a1a1a',
                            backgroundImage:
                              'linear-gradient(45deg, #262626 25%, transparent 25%), linear-gradient(-45deg, #262626 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262626 75%), linear-gradient(-45deg, transparent 75%, #262626 75%)',
                            backgroundSize: '16px 16px',
                            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                          }
                        : { backgroundColor: 'var(--surface)' }
                    }
                  >
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">
                      {String(s.n).padStart(2, '0')}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.url}
                      alt={s.file}
                      loading="lazy"
                      className="h-full w-full object-contain p-4 transition-transform group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-(--ink)">
                        {String(s.n).padStart(2, '0')}
                      </span>
                      <span className="truncate font-mono text-xs text-(--ink-2)">{s.file}</span>
                    </div>
                    {s.usage ? (
                      <span className="truncate text-xs text-(--ink-2)">{s.usage}</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                        Unused — on disk, not referenced
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      ))}
    </main>
  )
}
