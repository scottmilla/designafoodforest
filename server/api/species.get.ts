import { readLibrary } from '../utils/db'

// GET /api/species: the species library the designer uses. From the database when one is connected and has
// species in it (edited in /admin), otherwise the bundled Codex library. The app starts on the bundled copy and
// swaps this in as soon as it arrives.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'species', 60)
  const lib = await readLibrary()
  // edits in /admin show up within about 30 seconds
  setResponseHeader(event, 'cache-control', lib.error ? 'no-store' : 'public, max-age=0, s-maxage=30, stale-while-revalidate=300')
  return { source: lib.source, updatedAt: lib.updatedAt, count: lib.species.length, species: lib.species }
})
