'use client'

import { useEffect, useState } from 'react'

/** Stable anchor for the MCP row, for deep links to the section and the
 * Enable button's open-on-success hash. Lives in this client module so both the
 * server row and the client button can import it without crossing the boundary. */
export const MCP_SECTION_ID = 'chatgpt-claude'

/**
 * The enabled MCP row's `<details>`, made openable from outside the DOM tree.
 * It opens itself whenever the URL hash targets its id — which covers two paths:
 *   - deep links to the section (`/settings#chatgpt-claude`)
 *   - the Enable button, which sets the hash on success. The button lives in the
 *     collapsed row that this replaces, so it can't reach the details directly;
 *     the hash is the bridge. A `hashchange` listener (not just a mount read)
 *     catches the button's write even when this row mounts first.
 * After that it's user-controlled — closing it sticks.
 */
export function McpExpandable({
  id,
  className,
  summary,
  children,
}: {
  id: string
  className?: string
  summary: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}`) setOpen(true)
    }
    openIfTargeted()
    window.addEventListener('hashchange', openIfTargeted)
    return () => window.removeEventListener('hashchange', openIfTargeted)
  }, [id])

  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={className}
    >
      {summary}
      {children}
    </details>
  )
}
