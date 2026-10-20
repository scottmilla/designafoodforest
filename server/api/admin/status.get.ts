import { adminConfigured, adminSession } from '../../utils/admin'
import { dbConfigured, explainDbError, speciesCollection } from '../../utils/db'

// GET /api/admin/status: is the panel set up, am I signed in, is there a database and what's in it
export default defineEventHandler(async (event) => {
  const configured = adminConfigured()
  const signedIn = configured ? !!(await adminSession(event)).data.admin : false
  let db: 'none' | 'connected' | 'error' = dbConfigured() ? 'connected' : 'none'
  let count = 0
  let dbError: string | null = null
  if (signedIn && db === 'connected') {
    try {
      count = await (await speciesCollection())!.countDocuments()
    } catch (e) {
      db = 'error'
      dbError = explainDbError(e) // only shown to a signed-in admin
    }
  }
  return { configured, signedIn, db, dbError, count }
})
