import { adminConfigured, adminSession } from '../../utils/admin'

// POST /api/admin/logout
export default defineEventHandler(async (event) => {
  if (adminConfigured()) await (await adminSession(event)).clear()
  return { ok: true }
})
