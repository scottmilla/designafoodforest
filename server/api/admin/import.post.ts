import { validateSpecies } from '../../../shared/speciesSchema'
import { requireAdmin, requireDb } from '../../utils/admin'
import { toDoc } from '../../utils/db'

// POST /api/admin/import { species: [...], replace?: boolean }
// Load a library file (an Export JSON from /admin, or a list built by scripts/build-library.ts) into the database.
// Every record is checked first; if any is broken nothing is written and the reasons come back.
//   replace: false → add new species and update ones with the same id; everything else stays
//   replace: true  → the database becomes exactly this file (species not in it are deleted)
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const col = await requireDb()
  const body = await readBody<{ species?: unknown; replace?: boolean }>(event)
  const list = Array.isArray(body?.species) ? body.species : Array.isArray(body) ? (body as unknown[]) : null
  if (!list?.length) throw createError({ statusCode: 400, statusMessage: 'That file has no species in it.' })
  if (list.length > 5000) throw createError({ statusCode: 413, statusMessage: 'That is more than 5,000 species; split the file.' })
  const errors: string[] = []
  const good = list.flatMap((x, i) => {
    const r = validateSpecies(x)
    if (r.ok) return [r.value]
    errors.push(`#${i + 1} ${(x as any)?.name ?? ''}: ${r.errors.join('; ')}`)
    return []
  })
  const ids = good.map((s) => s.id)
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) errors.push(`Repeated ids: ${[...new Set(dup)].slice(0, 10).join(', ')}`)
  if (errors.length) throw createError({ statusCode: 422, statusMessage: `${errors.length} problem${errors.length > 1 ? 's' : ''} in that file; nothing was imported.`, data: { errors: errors.slice(0, 50) } })
  if (body?.replace) await col.deleteMany({ _id: { $nin: ids } })
  const r = await col.bulkWrite(good.map((sp, i) => ({ replaceOne: { filter: { _id: sp.id }, replacement: toDoc(sp, i + 1), upsert: true } })))
  return { ok: true, added: r.upsertedCount, updated: r.modifiedCount, total: await col.countDocuments() }
})
