import { validateSpecies } from '../../../../shared/speciesSchema'
import { requireAdmin, requireDb } from '../../../utils/admin'
import { toDoc } from '../../../utils/db'

// POST /api/admin/species { ...species }: add a new species (its id must be new)
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const col = await requireDb()
  const r = validateSpecies(await readBody(event))
  if (!r.ok) throw createError({ statusCode: 422, statusMessage: 'Some fields need fixing.', data: { errors: r.errors } })
  if (await col.findOne({ _id: r.value.id })) throw createError({ statusCode: 409, statusMessage: `A species with id "${r.value.id}" already exists. Change the name or stratum, or edit that one.` })
  const last = await col.find({}).sort({ order: -1 }).limit(1).next()
  await col.insertOne(toDoc(r.value, (last?.order ?? 0) + 1))
  return { ok: true, species: r.value }
})
