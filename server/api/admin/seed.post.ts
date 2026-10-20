import { requireAdmin, requireDb } from '../../utils/admin'
import { BUNDLED, toDoc } from '../../utils/db'

// POST /api/admin/seed { replace?: boolean }: copy the bundled Codex library into the database.
// Into an empty database it just fills it. With replace: true it puts every bundled species back as shipped
// (species added in the admin panel stay; bundled ones you edited are reset).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const col = await requireDb()
  const { replace } = (await readBody<{ replace?: boolean }>(event).catch(() => null)) ?? {}
  const count = await col.countDocuments()
  if (count && !replace) throw createError({ statusCode: 409, statusMessage: `The database already has ${count} species. Choose "reset to the bundled library" to overwrite the bundled ones.` })
  const ops = BUNDLED.map((sp, i) => ({ replaceOne: { filter: { _id: sp.id }, replacement: toDoc(sp, i + 1), upsert: true } }))
  const r = await col.bulkWrite(ops)
  return { ok: true, written: r.upsertedCount + r.modifiedCount, total: await col.countDocuments() }
})
