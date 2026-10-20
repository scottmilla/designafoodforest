import { describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { explainDbError } from '../server/utils/db'

// real driver errors for the usual set-up mistakes, turned into something a person can fix
const fail = async (uri: string) => {
  try {
    await MongoClient.connect(uri, { serverSelectionTimeoutMS: 2500 })
  } catch (e) {
    return explainDbError(e, uri)
  }
  return 'connected?!'
}

describe('database error explanations', () => {
  it('spots the Atlas placeholders left in', async () => {
    expect(await fail('mongodb+srv://<db_username>:<db_password>@cluster0.example.mongodb.net/')).toMatch(/placeholders/)
  })
  it('spots an unescaped @ in the password', async () => {
    expect(await fail('mongodb+srv://me:p@ss@cluster0.example.mongodb.net/')).toMatch(/malformed|URL-encode/)
  })
  it('spots a cluster address that does not exist', async () => {
    expect(await fail('mongodb+srv://me:pw@no-such-cluster-zz9.mongodb.net/')).toMatch(/cluster address|Couldn't connect/)
  }, 15000)
  it('explains a refused password and a blocked network', () => {
    const uri = 'mongodb+srv://me:pw@cluster0.example.mongodb.net/'
    expect(explainDbError(Object.assign(new Error('bad auth : authentication failed'), { name: 'MongoServerError', code: 8000 }), uri)).toMatch(/refused the username or password/)
    expect(explainDbError(Object.assign(new Error('Server selection timed out after 6000 ms'), { name: 'MongoServerSelectionError' }), uri)).toMatch(/Network Access/)
  })
  it('never repeats the connection string', () => {
    const uri = 'mongodb+srv://me:secret@cluster0.example.mongodb.net/'
    expect(explainDbError(new Error(`weird failure for ${uri}`), uri)).not.toContain('secret')
  })
})
