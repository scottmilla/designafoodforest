import { requireAdmin, requireDb } from '../../../utils/admin'

// DELETE /api/admin/species/:id. Designs that use it keep their file data, but those plants are skipped on screen.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const col = await requireDb()
  const id = getRouterParam(event, 'id') ?? ''
  const r = await col.deleteOne({ _id: id })
  if (!r.deletedCount) throw createError({ statusCode: 404, statusMessage: `No species "${id}" in the database.` })
  return { ok: true }
})
