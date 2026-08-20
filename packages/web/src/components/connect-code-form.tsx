'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { redeemConnectCode, type ConnectCodeState } from '@/app/(consumer)/connect/actions'

/**
 * Join an existing account from this browser using a code minted on another
 * device (CLI `skillet pair`, the desktop app, or another signed-in browser).
 * The redeem happens server-side; the session token never touches client JS.
 */
export function ConnectCodeForm({ redirectTo }: { redirectTo?: string }) {
  const [state, action, pending] = useActionState<ConnectCodeState, FormData>(redeemConnectCode, {})

  return (
    <form action={action}>
      {redirectTo && <input type="hidden" name="callbackUrl" value={redirectTo} />}
      <label className="block text-sm text-(--ink-2)" htmlFor="connect-code">
        Code from your other device
      </label>
      <span className="ui-input-shell mt-2">
        <input
          id="connect-code"
          name="code"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={11}
          required
          className="min-w-0 flex-1 bg-transparent font-mono uppercase tracking-[0.25em] outline-none placeholder:tracking-normal placeholder:text-(--ink-2)/60"
          placeholder="ABCD2345"
        />
      </span>
      <Button type="submit" disabled={pending} variant="primary" className="mt-4 w-full">
        {pending ? 'Connecting…' : 'Connect this browser'}
      </Button>
      {state.error && (
        <p className="mt-4 text-sm leading-relaxed text-(--danger)" role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}
