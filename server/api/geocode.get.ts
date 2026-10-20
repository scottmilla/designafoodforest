import type { GeoAnswer } from '../../shared/types'
import { parseCoords } from '../utils/addressText'
import { geocode, reverse } from '../utils/geocoders'

// GET /api/geocode?q=45 Kahikatea Flat Road, Dairy Flat   (or "37.694, -122.073")
// GET /api/geocode?q=<suggestion text>&key=<suggestion key>   (a pick from /api/geocode/suggest: exact, one lookup)
// Any address, place or coordinates → the best point to fly the map to, plus other places it could mean.
// Fast on purpose: the climate is read separately. How the services are combined: server/utils/geocoders.ts.
export default defineEventHandler(async (event): Promise<GeoAnswer> => {
  rateLimit(event, 'geocode', 30)
  const query = getQuery(event)
  const q = String(query.q ?? '').trim().slice(0, 200)
  const key = String(query.key ?? '').slice(0, 400) || undefined
  const country = /^[A-Z]{2}$/i.test(String(query.cc ?? '')) ? String(query.cc).toUpperCase() : undefined
  if (!q) throw createError({ statusCode: 400, statusMessage: 'Type an address or place' })

  const coords = parseCoords(q)
  if (coords) {
    const { lat, lon } = coords
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw createError({ statusCode: 400, statusMessage: 'Those coordinates are off the map' })
    const at = await reverse(lat, lon)
    return { label: at?.label ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`, full: at?.full ?? q, lat, lon, country: at?.country ?? '', precision: 'house' }
  }

  const found = await geocode(q, { key, country })
  if (!found.length) throw createError({ statusCode: 404, statusMessage: `We couldn't find "${q}". Pick one of the suggestions as you type, add the town, or paste lat, lng.` })
  const [best, ...rest] = found
  return { ...best!, alternatives: rest.slice(0, 4) }
})
