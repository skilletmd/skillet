import { signIn } from '@/auth'
import { GitHubIcon, GoogleIcon, TwitterIcon } from '@/components/auth-provider-icons'
import { Button } from '@/components/ui/button'
import { type AuthProvider, PROVIDER_LABEL } from '@/lib/auth-providers'

const PROVIDER_ICONS: Record<AuthProvider, typeof GoogleIcon> = {
  google: GoogleIcon,
  github: GitHubIcon,
  twitter: TwitterIcon,
}

export function SignInProviderButton({
  provider,
  redirectTo = '/settings',
}: {
  provider: AuthProvider
  redirectTo?: string
}) {
  const Icon = PROVIDER_ICONS[provider]

  return (
    <form
      action={async () => {
        'use server'
        await signIn(provider, { redirectTo })
      }}
      className="w-full"
    >
      <Button type="submit" variant="secondary" size="lg" block className="gap-3">
        <Icon className="h-5 w-5" />
        <span className="text-base font-semibold text-(--ink)">{PROVIDER_LABEL[provider]}</span>
      </Button>
    </form>
  )
}
