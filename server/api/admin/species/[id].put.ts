import { validateSpecies } from '../../../../shared/speciesSchema'
import { requireAdmin, requireDb } from '../../../utils/admin'
import { toDoc } from '../../../utils/db'

// PUT /api/admin/species/:id { ...species }: save changes to one species. The id stays the same (designs refer to it).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const col = await requireDb()
  const id = getRouterParam(event, 'id') ?? ''
  const r = validateSpecies({ ...(await readBody(event)), id })
  if (!r.ok) throw createError({ statusCode: 422, statusMessage: 'Some fields need fixing.', data: { errors: r.errors } })
  const old = await col.findOne({ _id: id })
  if (!old) throw createError({ statusCode: 404, statusMessage: `No species "${id}" in the database.` })
  await col.replaceOne({ _id: id }, toDoc(r.value, old.order))
  return { ok: true, species: r.value }
})
