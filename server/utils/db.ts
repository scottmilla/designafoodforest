import { MongoClient, type Collection } from 'mongodb'
import type { LibSpecies } from '../../shared/types'
import raw from '../../shared/library.json'

// The species library can live in MongoDB, so it can be edited in the admin panel (/admin) without a code change.
//   NUXT_MONGODB_URI   e.g. mongodb+srv://user:pass@cluster0.example.mongodb.net  (MongoDB Atlas works well with Vercel)
//   NUXT_MONGODB_DB    database name, default "designafoodforest"
// With no URI, or an empty collection, everyone gets the bundled library (shared/library.json) exactly as before.

export const BUNDLED = raw as unknown as LibSpecies[]
export type SpeciesDoc = LibSpecies & { _id: string; order: number; updatedAt: Date; updatedBy?: string }

let client: Promise<MongoClient> | null = null
let indexed = false

export function dbConfigured() {
  return !!useRuntimeConfig().mongodbUri
}

export async function speciesCollection(): Promise<Collection<SpeciesDoc> | null> {
  const { mongodbUri, mongodbDb } = useRuntimeConfig()
  if (!mongodbUri) return null
  // one connection per function instance, reused across requests (the usual pattern on serverless)
  client ??= MongoClient.connect(mongodbUri, { serverSelectionTimeoutMS: 6000, maxPoolSize: 5 }).catch((e) => {
    client = null
    throw e
  })
  const col = (await client).db(mongodbDb || 'designafoodforest').collection<SpeciesDoc>('species')
  if (!indexed) {
    indexed = true
    await col.createIndex({ order: 1, name: 1 }).catch(() => (indexed = false))
  }
  return col
}

// a stored document back to the plain species the app uses
export function fromDoc(d: SpeciesDoc): LibSpecies {
  const { _id, order, updatedAt, updatedBy, ...sp } = d
  return sp as LibSpecies
}
export const toDoc = (sp: LibSpecies, order: number, by?: string): SpeciesDoc => ({ ...sp, _id: sp.id, order, updatedAt: new Date(), ...(by ? { updatedBy: by } : {}) })

// the library everyone sees: the database's when it has one, otherwise the bundled one
export async function readLibrary(): Promise<{ species: LibSpecies[]; source: 'db' | 'bundled'; updatedAt: string | null; error?: string }> {
  let col: Collection<SpeciesDoc> | null = null
  try {
    col = await speciesCollection()
  } catch {
    return { species: BUNDLED, source: 'bundled', updatedAt: null, error: 'The species database is not answering; showing the bundled library.' }
  }
  if (!col) return { species: BUNDLED, source: 'bundled', updatedAt: null }
  const docs = await col.find({}).sort({ order: 1, name: 1 }).toArray()
  if (!docs.length) return { species: BUNDLED, source: 'bundled', updatedAt: null }
  const latest = docs.reduce((a, d) => (d.updatedAt > a ? d.updatedAt : a), new Date(0))
  return { species: docs.map(fromDoc), source: 'db', updatedAt: latest.toISOString() }
}
