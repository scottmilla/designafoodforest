import { adminConfigured, adminSession } from '../../utils/admin'
import { BUNDLED, dbConfigured, speciesCollection } from '../../utils/db'

// GET /api/admin/status: is the panel set up, am I signed in, is there a database and what's in it
export default defineEventHandler(async (event) => {
  const configured = adminConfigured()
  const signedIn = configured ? !!(await adminSession(event)).data.admin : false
  let db: 'none' | 'connected' | 'error' = dbConfigured() ? 'connected' : 'none'
  let count = 0
  if (signedIn && db === 'connected') {
    try {
      count = await (await speciesCollection())!.countDocuments()
    } catch {
      db = 'error'
    }
  }
  return { configured, signedIn, db, count, bundled: BUNDLED.length }
})
