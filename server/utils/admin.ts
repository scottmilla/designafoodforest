import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { speciesCollection } from './db'

// The admin panel's lock: one shared password (NUXT_ADMIN_PASSWORD), and a signed, http-only session cookie once
// you're in. NUXT_SESSION_SECRET (32+ characters) signs the cookie; without it one is derived from the password,
// so changing the password signs everyone out. No admin password set → the admin panel stays closed.
const sessionConfig = () => {
  const { adminPassword, sessionSecret } = useRuntimeConfig()
  const password = sessionSecret && sessionSecret.length >= 32 ? sessionSecret : createHash('sha256').update(`daff-admin:${adminPassword}`).digest('hex')
  return { name: 'daff-admin', password, maxAge: 60 * 60 * 12, cookie: { sameSite: 'strict' as const, httpOnly: true, secure: !import.meta.dev } }
}

export function adminConfigured() {
  return !!useRuntimeConfig().adminPassword
}

export function passwordMatches(given: string) {
  const want = createHash('sha256').update(String(useRuntimeConfig().adminPassword)).digest()
  const got = createHash('sha256').update(String(given)).digest()
  return timingSafeEqual(want, got)
}

export async function adminSession(event: H3Event) {
  return useSession<{ admin?: boolean; at?: number }>(event, sessionConfig())
}

export async function requireAdmin(event: H3Event) {
  if (!adminConfigured()) throw createError({ statusCode: 503, statusMessage: 'The admin panel is not set up: set NUXT_ADMIN_PASSWORD on the server.' })
  const s = await adminSession(event)
  if (!s.data.admin) throw createError({ statusCode: 401, statusMessage: 'Please sign in.' })
  return s
}

export async function requireDb() {
  const col = await speciesCollection().catch(() => {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach the species database. Check NUXT_MONGODB_URI.' })
  })
  if (!col) throw createError({ statusCode: 503, statusMessage: 'No database is connected: set NUXT_MONGODB_URI to edit the library.' })
  return col
}
