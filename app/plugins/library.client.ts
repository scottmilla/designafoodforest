import type { LibSpecies } from '#shared/types'
import { setLibrary } from '~/utils/library'

// Swap in the species library from the database (if one is connected) as soon as the app starts. Until it
// answers, or if it can't, the bundled library is used, so nothing ever waits on this.
export default defineNuxtPlugin(() => {
  $fetch<{ source: 'db' | 'bundled'; species: LibSpecies[] }>('/api/species')
    .then((r) => {
      if (r.source === 'db') setLibrary(r.species, 'db')
    })
    .catch(() => {})
})
