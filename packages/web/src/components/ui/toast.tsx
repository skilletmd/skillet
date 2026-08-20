'use client'

import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * App-wide toast on Radix (a11y role=status, swipe-to-dismiss, timed dismissal).
 * Mount <ToastProvider> once at the root; call `useToast()` anywhere to push a
 * transient message with an optional action (e.g. "Unsubscribed · Undo").
 * Styling is ours: --surface panel, --line border, soft shadow, bottom-right.
 */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  message: string
  action?: ToastAction
}

const ToastContext = createContext<(t: { message: string; action?: ToastAction }) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((t: { message: string; action?: ToastAction }) => {
    // Monotonic-ish id without Date.now collisions under rapid fire.
    setToasts((prev) => [...prev, { ...t, id: (prev.at(-1)?.id ?? 0) + 1 }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={push}>
      <RadixToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            className="ui-toast flex items-center gap-3 surface-card py-2.5 pl-4 pr-2.5 shadow-(--shadow-lg)"
            onOpenChange={(open) => {
              if (!open) dismiss(t.id)
            }}
          >
            <RadixToast.Description className="text-sm text-(--ink)">
              {t.message}
            </RadixToast.Description>
            {t.action ? (
              <RadixToast.Action
                altText={t.action.label}
                className="rounded-md px-2.5 py-1 text-sm font-medium text-(--accent) transition-colors hover:bg-(--accent-bg)"
                onClick={t.action.onClick}
              >
                {t.action.label}
              </RadixToast.Action>
            ) : null}
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}
