import { requireAdmin } from '../../../utils/admin'
import { readLibrary } from '../../../utils/db'

// GET /api/admin/species: every species, and whether they came from the database or the bundled file
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return readLibrary()
})
