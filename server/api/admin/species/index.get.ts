import { requireAdmin } from '../../../utils/admin'
import { readLibrary } from '../../../utils/db'

// GET /api/admin/species: every species in the database
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return readLibrary()
})
