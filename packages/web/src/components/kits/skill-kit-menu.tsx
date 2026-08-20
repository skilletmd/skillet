'use client'

import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode, RefObject } from 'react'

/** Portaled kit picker menu — lazy-loaded on first open to keep motion off list pages. */
export function SkillKitDropdown({
  open,
  menuPos,
  portalRef,
  children,
}: {
  open: boolean
  menuPos: { top: number; left: number } | null
  portalRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  const ease = [0.16, 1, 0.3, 1] as const

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && menuPos && (
        <motion.div
          ref={portalRef}
          className="skill-kit-menu"
          role="menu"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            right: 'auto',
            zIndex: 1000,
            transformOrigin: 'top left',
          }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: reduce ? 0 : 0.16, ease }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
