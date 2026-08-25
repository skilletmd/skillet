import type { ReactNode } from 'react'
import { ScrollTopOnEnter } from '@/components/scroll-top-on-enter'

/**
 * Wraps every document page under a handle: the profile, a skill, a kit, and the
 * author kit.
 *
 * It exists for the scroll reset. All four render a shell synchronously and
 * stream the body, so Next's scroll handler sees the new content as already in
 * view and keeps the previous page's offset — click a card near the bottom of
 * /browse/people and the profile opens with its name under the header.
 *
 * A layout rather than four page edits: it mounts once on entry from elsewhere,
 * and stays mounted across handle-to-handle navigation, where the pathname key
 * inside the component is what re-fires the reset.
 */
export default function AuthorDocumentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ScrollTopOnEnter />
      {children}
    </>
  )
}
