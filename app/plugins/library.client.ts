import type { LibSpecies } from '#shared/types'
import { libraryFailed, setLibrary } from '~/utils/library'

// Load the species library from the database as the app starts (it isn't bundled in the code). A few retries with
// a pause between, in case the database is waking up; after that the app says the library is unavailable.
export default defineNuxtPlugin(() => {
  const load = async (attempt = 1): Promise<void> => {
    try {
      const r = await $fetch<{ species: LibSpecies[]; error?: string }>('/api/species')
      if (r.species?.length) return setLibrary(r.species)
      if (attempt >= 3) return libraryFailed(r.error || 'The species library is empty.')
    } catch (e: any) {
      if (attempt >= 3) return libraryFailed(e?.data?.statusMessage || 'Could not load the species library.')
    }
    await new Promise((res) => setTimeout(res, 1500 * attempt))
    return load(attempt + 1)
  }
  load()
})
