import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names, resolving conflicts so the last wins (e.g.
 * `cn('px-2', condition && 'px-4')` → `px-4`). The single helper every
 * `components/ui/*` primitive uses to compose its classes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
