import type { Metadata } from 'next'
import { RisoLab } from './riso-lab'

export const metadata: Metadata = {
  title: 'Cover experiments — Lab',
  robots: { index: false, follow: false },
}

export default function CoverExperimentsPage() {
  return <RisoLab />
}
