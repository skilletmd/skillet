import { cache } from 'react'
import { auth } from '@/auth'

/** One session decode per request — safe to call from layout + page + nested RSCs. */
export const getSession = cache(auth)
