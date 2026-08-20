'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useBfcacheRestore } from '@/lib/use-bfcache-restore'

/**
 * Passwordless email sign-in via a one-time code (the OAuth-first fallback).
 * Two steps: request a code for an email, then enter the code. The session is
 * minted where the user types the code — scanner-proof and cross-device, unlike
 * the retired magic link. Google OAuth remains the headline path above this.
 */
export function LoginCodeForm({
  heading = 'Or continue with email',
  bordered = true,
}: {
  heading?: string | null
  bordered?: boolean
} = {}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'verifying' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  // Browser-back after signing in restores this page from the bfcache with the
  // submit button stuck on "Verifying…" (its navigation died with the page).
  useBfcacheRestore(() => setStatus('idle'))

  function callbackUrl(): string | undefined {
    return new URLSearchParams(window.location.search).get('callbackUrl') || undefined
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setMessage(null)
    setDevCode(null)
    try {
      const res = await fetch('/api/auth/login-code/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const body = (await res.json()) as { message?: string; dev_code?: string }
      if (!res.ok) {
        setStatus('error')
        setMessage(body.message ?? 'Could not send a code. Try again shortly.')
        return
      }
      setStep('code')
      setStatus('idle')
      if (body.dev_code) setDevCode(body.dev_code)
    } catch {
      setStatus('error')
      setMessage('Network error. Is the registry running?')
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setStatus('verifying')
    setMessage(null)
    try {
      const res = await fetch('/api/auth/login-code/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), callbackUrl: callbackUrl() }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; redirectTo?: string }
      if (!res.ok || !body.ok) {
        setStatus('error')
        setMessage(
          body.error === 'too_many_attempts'
            ? 'Too many wrong codes. Request a new one.'
            : "That code didn't match or has expired. Check your email or request a new one.",
        )
        return
      }
      // Full navigation so the freshly-set session cookie + Auth.js session apply.
      window.location.href = body.redirectTo || '/feed'
    } catch {
      setStatus('error')
      setMessage('Network error. Try again.')
    }
  }

  const wrapClass = bordered ? 'mt-8 border-t border-(--line) pt-8' : ''
  const sentEmail = email.trim()
  const devCodeBlock = devCode && (
    <p className="mt-4 rounded-lg px-3 py-2 font-mono text-xs text-(--ink-2)">
      Local dev code: <span className="text-(--accent)">{devCode}</span>
    </p>
  )

  if (step === 'code') {
    return (
      <form onSubmit={submitCode} className={wrapClass}>
        <p className="text-sm leading-relaxed text-(--ink-2)">
          Enter the code we sent to <span className="font-medium text-(--ink)">{sentEmail}</span>.
        </p>
        <Input
          id="login-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          size="lg"
          aria-label="Sign-in code"
          autoFocus
          required
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="mt-4 font-mono tracking-widest"
        />
        <Button
          type="submit"
          disabled={status === 'verifying'}
          variant="primary"
          size="lg"
          className="mt-4 w-full"
        >
          {status === 'verifying' ? 'Verifying…' : 'Sign in'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setStep('email')
            setCode('')
            setStatus('idle')
            setMessage(null)
          }}
          className="mt-4 text-sm font-medium text-(--ink-2) underline-offset-2 hover:text-(--ink) hover:underline"
        >
          Use a different email
        </button>
        {status === 'error' && message && (
          <p className="mt-4 text-sm leading-relaxed text-(--danger)" role="status">
            {message}
          </p>
        )}
        {devCodeBlock}
      </form>
    )
  }

  return (
    <form onSubmit={requestCode} className={wrapClass}>
      {heading && (
        <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">{heading}</p>
      )}
      <Input
        id="login-email"
        type="email"
        size="lg"
        aria-label="Email address"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className={heading ? 'mt-4' : ''}
      />
      <Button
        type="submit"
        disabled={status === 'sending'}
        variant="primary"
        size="lg"
        className="mt-4 w-full"
      >
        {status === 'sending' ? 'Sending…' : 'Email me a code'}
      </Button>
      {status === 'error' && message && (
        <p className="mt-4 text-sm leading-relaxed text-(--danger)" role="status">
          {message}
        </p>
      )}
    </form>
  )
}
