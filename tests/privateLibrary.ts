import { existsSync, readFileSync } from 'node:fs'
import type { LibSpecies } from '../shared/types'

// The species library isn't in the repo (it lives in the database). Tests that need real species read the private,
// git-ignored copy in private/library.json (made by `npm run library`, or saved from /admin → Export JSON) and are
// skipped on a machine that doesn't have it.
const file = new URL('../private/library.json', import.meta.url)
export const privateLibrary: LibSpecies[] | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
export const hasLibrary = !!privateLibrary?.length
