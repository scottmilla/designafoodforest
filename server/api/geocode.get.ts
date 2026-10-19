import type { GeoResult } from '../../shared/types'

// GET /api/geocode?q=1 Eden Canyon Rd, Castro Valley  (or "37.694, -122.073")
// Any address, place or coordinates → a point to fly the map to. Fast on purpose: the climate is read separately.
//
// Geocoder: OpenStreetMap's public Nominatim. Its usage policy asks for an identifying User-Agent, at most 1
// request per second, and no heavy commercial use (https://operations.osmfoundation.org/policies/nominatim/).
// We send the NUXT_CONTACT_EMAIL as identification, cache answers, and space requests out. If you outgrow it, swap
// `search()` for Mapbox, Google, Geoapify or a self-hosted Nominatim; nothing else in the app needs to change.
const ua = () => {
  const email = useRuntimeConfig().contactEmail
  return { 'User-Agent': `designafoodforest/0.1 (food forest designer${email ? '; ' + email : ''})` }
}
// one Nominatim request per second, per function instance
let last = 0
async function throttle() {
  const wait = last + 1000 - Date.now()
  last = Math.max(Date.now(), last + 1000) // reserve the next slot before waiting, so concurrent calls queue up
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
}

export default defineEventHandler(async (event): Promise<GeoResult> => {
  rateLimit(event, 'geocode', 20)
  const q = String(getQuery(event).q ?? '').trim().slice(0, 200)
  if (!q) throw createError({ statusCode: 400, statusMessage: 'Type an address or place' })

  const coords = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (coords) {
    const lat = +coords[1]!
    const lon = +coords[2]!
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw createError({ statusCode: 400, statusMessage: 'Those coordinates are off the map' })
    const near = await reverse(lat, lon)
    return { label: near?.label ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`, full: near?.full ?? q, lat, lon, country: near?.country ?? '' }
  }

  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '1', q })
  await throttle()
  const [hit] = await $fetch<any[]>(`https://nominatim.openstreetmap.org/search?${params}`, { headers: ua(), timeout: 9000 }).catch(() => {
    throw createError({ statusCode: 502, statusMessage: 'The address service is not answering. Try again, or paste coordinates.' })
  })
  if (!hit) throw createError({ statusCode: 404, statusMessage: `We couldn't find "${q}". Try adding the town, or paste lat, lng.` })
  const bb = (hit.boundingbox ?? []).map(Number)
  return {
    label: shortLabel(hit.address ?? {}, hit.name || hit.display_name),
    full: hit.display_name,
    lat: +hit.lat,
    lon: +hit.lon,
    country: String(hit.address?.country_code ?? '').toUpperCase(),
    ...(bb.length === 4 ? { bbox: bb as [number, number, number, number] } : {}),
  }
})

function shortLabel(a: Record<string, string>, fallback: string) {
  const street = a.road ? `${a.house_number ? a.house_number + ' ' : ''}${a.road}` : ''
  const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || ''
  const region = a.state || a.region || ''
  return [...new Set([street || fallback, town, street ? '' : region].filter(Boolean))].slice(0, 2).join(', ') || fallback
}

async function reverse(lat: number, lon: number) {
  try {
    const p = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '14', addressdetails: '1' })
    await throttle()
    const r = await $fetch<any>(`https://nominatim.openstreetmap.org/reverse?${p}`, { headers: ua(), timeout: 6000 })
    if (!r?.address) return null
    return { label: shortLabel(r.address, r.display_name), full: r.display_name as string, country: String(r.address.country_code ?? '').toUpperCase() }
  } catch {
    return null
  }
}
