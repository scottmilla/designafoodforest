import type { GeoSuggestion } from '../../../shared/types'
import { esriSuggest } from '../../utils/geocoders'

// GET /api/geocode/suggest?q=45 Kahikatea Fl&cc=NZ
// Type-ahead for the address box (Esri's suggest service, built for exactly this). `cc` is the person's own
// country from their browser: those matches come first, then the rest of the world.
export default defineEventHandler(async (event): Promise<{ suggestions: GeoSuggestion[] }> => {
  rateLimit(event, 'suggest', 120)
  const query = getQuery(event)
  const q = String(query.q ?? '').trim().slice(0, 120)
  const cc = /^[A-Z]{2}$/i.test(String(query.cc ?? '')) ? String(query.cc).toUpperCase() : undefined
  if (q.length < 3) return { suggestions: [] }
  const [local, world] = await Promise.all([
    cc ? esriSuggest(q, cc).catch(() => []) : Promise.resolve([]),
    esriSuggest(q).catch(() => []),
  ])
  const seen = new Set<string>()
  const out = [...local, ...world].filter((s) => !seen.has(s.text) && seen.add(s.text)).slice(0, 6)
  if (out.length) setResponseHeader(event, 'cache-control', 'public, max-age=300, s-maxage=3600')
  return { suggestions: out }
})
