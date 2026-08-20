import { Avatar } from '@/components/ui/avatar'
import { defaultAvatarUrls } from '@/lib/avatar-color'

export const metadata = {
  title: 'Default avatars — Skillet',
  robots: { index: false },
}

/**
 * Internal QA page: every illustrated default avatar, numbered, on its tinted
 * circle. The number is the file index (face-NN.svg).
 */
export default function DefaultAvatarsPage() {
  const urls = defaultAvatarUrls()
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">Default avatars</h1>
      <p className="mt-1 text-sm text-(--ink-2)">
        {urls.length} hand-drawn faces (SVG). The number is the file index (face-NN.svg). Tint
        cycles so you can see each face on a few different circles.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 md:grid-cols-6">
        {urls.map((url, i) => {
          const n = i + 1
          return (
            <div key={url} className="flex flex-col items-center gap-2">
              <Avatar src={url} name={`Face ${n}`} colorKey={`tint-${n}`} size="lg" />
              <span className="font-mono text-sm text-(--ink-2)">{String(n).padStart(2, '0')}</span>
            </div>
          )
        })}
      </div>
    </main>
  )
}
