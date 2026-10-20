import { describe, expect, it } from 'vitest'
import raw from '../shared/library.json'
import type { LibSpecies } from '../shared/types'
import { blankSpecies, speciesId, validateSpecies } from '../shared/speciesSchema'

const LIB = raw as unknown as LibSpecies[]

describe('species records', () => {
  it('accepts every species in the bundled Codex library unchanged', () => {
    for (const sp of LIB) {
      const r = validateSpecies(sp)
      if (!r.ok) throw new Error(`${sp.id}: ${r.errors.join('; ')}`)
      // the only change allowed: repeated tags collapse to one
      const dedupe = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v)] : v]))
      expect(JSON.parse(JSON.stringify(r.value))).toEqual(dedupe(JSON.parse(JSON.stringify(sp))))
    }
  })
  it('rejects broken records with readable reasons', () => {
    const r = validateSpecies({ ...blankSpecies(), name: '', code: 'X', targetRS: [5, 2], leaf: 'green' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('name is required')
      expect(r.errors.some((e) => e.startsWith('code must be one of'))).toBe(true)
      expect(r.errors.some((e) => e.startsWith('targetRS'))).toBe(true)
      expect(r.errors.some((e) => e.startsWith('leaf'))).toBe(true)
    }
  })
  it('makes ids the way the build script does', () => {
    expect(speciesId('Ice Cream Bean', 'E')).toBe('ice-cream-bean-e')
    const r = validateSpecies({ ...blankSpecies(), name: 'Pigeon Pea', code: 'L' })
    expect(r.ok && r.value.id).toBe('pigeon-pea-l')
  })
})
