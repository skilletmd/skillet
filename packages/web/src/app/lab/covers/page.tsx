import type { Metadata } from 'next'
import { CoverArt } from '@/components/cover/cover'
import { CATEGORY_BY_KEY, type CategoryKey } from '@/lib/categories'

export const metadata: Metadata = {
  title: 'Covers — Lab',
  robots: { index: false, follow: false },
}

// The real production cover engine (CoverArt) across a spread of kits and single
// skills — just for seeing how they read together. Seeds are arbitrary but fixed,
// so each cover is stable. Ordered code → create → grow so the hue families cluster.
type KitSample = { seed: string; name: string; cats: CategoryKey[] }

const KITS: KitSample[] = [
  { seed: 'k12', name: 'Platform Core', cats: ['backend', 'devops', 'database', 'security'] },
  { seed: 'k15', name: 'Deploy Pipeline', cats: ['devops', 'backend', 'security', 'quality'] },
  { seed: 'k01', name: 'Ship Frontend', cats: ['frontend', 'design', 'quality'] },
  { seed: 'k06', name: 'Design System', cats: ['design', 'frontend', 'product', 'media', 'writing'] },
  { seed: 'k14', name: 'Creative Studio', cats: ['media', 'design', 'writing'] },
  { seed: 'k11', name: 'Content Engine', cats: ['writing', 'marketing', 'media', 'research', 'design', 'product'] },
  { seed: 'k02', name: 'Growth Stack', cats: ['marketing', 'sales', 'writing', 'product'] },
  { seed: 'k07', name: 'Founder Toolkit', cats: ['product', 'finance', 'writing', 'sales'] },
]

const SINGLES: CategoryKey[] = [
  'backend',
  'security',
  'agents',
  'frontend',
  'mobile',
  'design',
  'media',
  'writing',
  'research',
  'marketing',
  'sales',
  'finance',
]

function Cover({ seed, cats, label, sub }: { seed: string; cats: CategoryKey[]; label: string; sub?: string }) {
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-xl">
        <CoverArt seed={seed} categories={cats} className="absolute inset-0 h-full w-full" />
      </div>
      <p className="mt-1.5 text-sm font-medium text-(--ink)">{label}</p>
      {sub ? <p className="text-xs text-(--ink-2)">{sub}</p> : null}
    </div>
  )
}

export default function CoversPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-12">
      <h1 className="text-2xl font-bold text-(--ink)">Covers</h1>
      <p className="mt-2 mb-10 max-w-2xl text-sm text-(--ink-2)">
        The production cover engine across a spread of kits and single skills — just for seeing.
      </p>

      <h2 className="text-lg font-semibold text-(--ink)">Kits</h2>
      <div className="mt-4 mb-12 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        {KITS.map((k) => (
          <Cover key={k.seed} seed={k.seed} cats={k.cats} label={k.name} sub={`${k.cats.length} skills`} />
        ))}
      </div>

      <h2 className="text-lg font-semibold text-(--ink)">Single skills</h2>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
        {SINGLES.map((c) => (
          <Cover key={c} seed={`s-${c}`} cats={[c]} label={CATEGORY_BY_KEY[c].label} />
        ))}
      </div>
    </main>
  )
}
