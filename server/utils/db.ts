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

// Why the database can't be reached, in words someone can act on. Never includes the URI or the password.
export function explainDbError(e: unknown, uri = useRuntimeConfig().mongodbUri as string): string {
  const msg = String((e as any)?.message ?? e ?? '')
  const name = String((e as any)?.name ?? '')
  const code = (e as any)?.code
  if (/<db_(username|password)>|<username>|<password>/i.test(uri)) return 'NUXT_MONGODB_URI still has the <db_username> / <db_password> placeholders in it: replace them (and the < >) with your database user\'s name and password.'
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) return 'NUXT_MONGODB_URI should start with mongodb+srv:// (copy it from Atlas → Connect → Drivers).'
  if (name === 'MongoParseError' || /URI|malformed|must be escaped|percent/i.test(msg)) return 'NUXT_MONGODB_URI is malformed. If the password has characters like @ : / ? # % in it, URL-encode them (e.g. @ → %40) or make a password without them.'
  if (code === 18 || code === 8000 || /bad auth|authentication failed|auth.*fail/i.test(msg)) return 'MongoDB refused the username or password. Check the database user in Atlas → Security → Database Access (it\'s not your Atlas login), and URL-encode special characters in the password.'
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'The cluster address in NUXT_MONGODB_URI wasn\'t found. Copy the connection string from Atlas again (the part after @, e.g. cluster0.xxxxx.mongodb.net).'
  if (name === 'MongoServerSelectionError' || /timed out|ECONNREFUSED|Server selection/i.test(msg)) return 'Couldn\'t connect in time. Most often Atlas is blocking the server: in Atlas → Security → Network Access, add 0.0.0.0/0 ("allow access from anywhere"), since Vercel\'s addresses change. Also check the cluster isn\'t paused.'
  if (/not authorized|unauthorized/i.test(msg)) return 'The database user can sign in but isn\'t allowed to read/write. Give it "Read and write to any database" in Atlas → Database Access.'
  return `MongoDB error: ${msg.replace(/mongodb(\+srv)?:\/\/[^\s]+/g, '[uri]').slice(0, 200)}`
}
let lastDbError: string | null = null
export const dbProblem = () => lastDbError

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
  // a connection is lazy: make sure it really answers (auth and network) before we rely on it
  if (!indexed) await (await client).db(mongodbDb || 'designafoodforest').command({ ping: 1 })
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
  let docs: SpeciesDoc[] = []
  try {
    col = await speciesCollection()
    if (col) docs = await col.find({}).sort({ order: 1, name: 1 }).toArray()
    lastDbError = null
  } catch (e) {
    client = null // try a fresh connection next time
    lastDbError = explainDbError(e)
    console.error('[species db]', lastDbError, '|', (e as any)?.name, (e as any)?.code ?? '')
    return { species: BUNDLED, source: 'bundled', updatedAt: null, error: `The species database is not answering; showing the bundled library. ${lastDbError}` }
  }
  if (!col) return { species: BUNDLED, source: 'bundled', updatedAt: null }
  if (!docs.length) return { species: BUNDLED, source: 'bundled', updatedAt: null }
  const latest = docs.reduce((a, d) => (d.updatedAt > a ? d.updatedAt : a), new Date(0))
  return { species: docs.map(fromDoc), source: 'db', updatedAt: latest.toISOString() }
}
