import { redirect } from 'next/navigation'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { Panel } from '@/components/ui/panel'
import { PAGE_TITLE_CLASS } from '@/lib/page-layout'
import { authErrorMessage, safeCallbackPath } from '@/lib/auth-errors'
import { SignInProviderButton } from '@/components/sign-in-provider-button'
import { LoginCodeForm } from '@/components/login-code-form'
import { ConnectCodeDisclosure } from '@/components/connect-code-disclosure'
import { LoginScatterAvatars, LoginAgentCompat } from '@/components/login-decor'
import { configuredLoginProviders } from '@/lib/auth-providers'
import { auth } from '@/auth'
import { resolvePostLoginPath } from '@/lib/post-login-redirect'
import { hasClaimedHandle } from '@/lib/activity-gate'

export const metadata = {
  title: 'Sign in · Skillet',
  description: 'Sign in to Skillet with email or Google.',
}

async function LoginPageContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; mode?: string }>
}) {
  const sp = await searchParams
  const redirectTo = safeCallbackPath(sp.callbackUrl)
  // Same page, same passwordless flow; the title just reflects the intent the
  // user arrived with (the nav's "Sign up" links here with mode=signup).
  // The default is "Continue" rather than "Log in" because most arrivals here
  // have no account yet: `skillet connect` sends people to /settings, which
  // bounces through this page, and signing in with Google is what creates the
  // account. "Log in" told those people they were in the wrong place.
  const title = sp.mode === 'signup' ? 'Join Skillet' : 'Continue to Skillet'

  // Already signed in? Don't show the sign-in form — bounce to where they meant
  // to go. (Also closes a fork vector: a logged-in user re-entering a different
  // email here would otherwise create a second account.)
  const session = await auth()
  if (session?.user) {
    // session.handle is already resolved (with the whoami self-heal), so it's
    // authoritative here: a handle-less signed-in user headed for a handle-gated
    // callbackUrl is diverted to /settings (other destinations are left alone).
    redirect(
      resolvePostLoginPath({
        callbackUrl: sp.callbackUrl,
        hasHandle: hasClaimedHandle(session.handle),
      }),
    )
  }

  const errorMessage = authErrorMessage(sp.error)
  const providers = configuredLoginProviders()

  return (
    <main className="marketing-home consumer-theme relative min-h-[calc(100dvh-var(--site-header-h,64px)-5.25rem)] overflow-hidden">
      <LoginScatterAvatars />

      {/* Fill the viewport down to the footer: nav height from the real --site-header-h
          var, ~5.25rem = the footer's height, so main's bottom edge lands on the footer
          rule and the bottom avatars crop right on that line. */}
      <div className="relative z-10 mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-8 pb-16 sm:pt-10">
        <div className="mx-auto max-w-lg">
          <div className="text-center">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            <p className="mx-auto mt-4 max-w-[42ch] text-lg leading-[1.45] text-(--ink-2)">
              Better skills for your agent, from the people worth following.
            </p>
          </div>

          {errorMessage && (
            <div
              className="mt-8 rounded-xl border border-(--danger-line)/50 bg-(--danger-bg) px-4 py-3 text-sm leading-relaxed text-(--danger) dark:border-(--danger-line)/40 dark:bg-(--danger-bg)/30 dark:text-(--danger)"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          <Panel padding="lg" elevated className="mt-10">
            {providers.length > 0 && (
              <>
                <div className="flex flex-col gap-3">
                  {providers.map((provider) => (
                    <SignInProviderButton
                      key={provider}
                      provider={provider}
                      redirectTo={redirectTo}
                    />
                  ))}
                </div>
                <LoginCodeForm heading={null} />
              </>
            )}
            {providers.length === 0 && <LoginCodeForm heading={null} bordered={false} />}
          </Panel>

          <ConnectCodeDisclosure redirectTo={redirectTo} />

          <LoginAgentCompat />
        </div>
      </div>
    </main>
  )
}

export default function LoginPage(props: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}) {
  return (
    <DynamicPageBoundary>
      <LoginPageContent {...props} />
    </DynamicPageBoundary>
  )
}
