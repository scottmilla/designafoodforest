import { readLibrary } from '../utils/db'

// GET /api/species: the species library the designer uses, from the database (edited in /admin). The app has no
// copy of its own and loads this as it starts.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'species', 60)
  const lib = await readLibrary()
  // edits in /admin show up within about 30 seconds
  setResponseHeader(event, 'cache-control', lib.species.length ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' : 'no-store')
  if (!lib.species.length) return { source: lib.source, updatedAt: null, count: 0, species: [], error: lib.error }
  return { source: lib.source, updatedAt: lib.updatedAt, count: lib.species.length, species: lib.species }
})
