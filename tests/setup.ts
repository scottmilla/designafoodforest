import { setLibrary } from '../app/utils/library'
import { privateLibrary } from './privateLibrary'

// load the private species library (if this machine has it) the way the app does from /api/species
if (privateLibrary?.length) setLibrary(privateLibrary)
