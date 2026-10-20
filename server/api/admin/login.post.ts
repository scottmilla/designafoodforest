import { adminConfigured, adminSession, passwordMatches } from '../../utils/admin'

// POST /api/admin/login { password }
export default defineEventHandler(async (event) => {
  rateLimit(event, 'admin-login', 8) // a few tries a minute, so the password can't be guessed by brute force
  if (!adminConfigured()) throw createError({ statusCode: 503, statusMessage: 'The admin panel is not set up: set NUXT_ADMIN_PASSWORD on the server.' })
  const body = await readBody<{ password?: string }>(event)
  if (!body?.password || !passwordMatches(body.password)) throw createError({ statusCode: 401, statusMessage: 'That password is not right.' })
  const s = await adminSession(event)
  await s.update({ admin: true, at: Date.now() })
  return { ok: true }
})
