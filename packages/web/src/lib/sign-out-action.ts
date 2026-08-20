'use server'

import { signOut } from '@/auth'

export async function signOutFromWeb(redirectTo = '/'): Promise<void> {
  await signOut({ redirectTo })
}
