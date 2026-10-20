import type { Code, CodexClimate, Form, LibSpecies, Lifecycle, Region, Strata, Succession } from './types'

// What a species record must look like, checked the same way in the admin form and on the server before anything
// is written to the database. Hand-rolled (no schema library) so it's easy to read and change.

export const CODES: Code[] = ['E', 'H', 'M', 'L']
export const LIFECYCLES: Lifecycle[] = ['Short', 'Short-Medium', 'Short-Perennial', 'Medium', 'Long']
export const FORMS: Form[] = ['round', 'spreading', 'columnar', 'conifer', 'palm', 'shrub', 'pollard', 'vine', 'herb']
export const CLIMATES: CodexClimate[] = ['Temperate', 'Mediterranean', 'Subtropical', 'Tropical']
export const LAYERS: Strata[] = ['emergent', 'high', 'medium', 'low', 'ground']
export const SUCCESSIONS: Succession[] = ['placenta', 'secondary', 'climax']
export const REGIONS: Region[] = [
  'na-east', 'na-west', 'na-southwest', 'mesoamerica', 'caribbean', 'sa-tropical', 'sa-temperate', 'europe', 'mediterranean', 'africa', 'asia-east', 'asia-south', 'oceania',
]
export const ROLES = ['fruit', 'berry', 'nut', 'staple', 'timber', 'support', 'nfix', 'biomass', 'flower', 'wildlife', 'herb', 'medicinal']
export const USES = ['culinary', 'tea', 'medicinal', 'pollinator', 'aromatic']

// an id from a name and stratum, the way the build script makes them: "Ice Cream Bean", H → "ice-cream-bean-h"
export const speciesId = (name: string, code: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${code.toLowerCase()}`

export function blankSpecies(): LibSpecies {
  return {
    id: '', name: '', latin: '', code: 'M', lifecycle: 'Medium', phase: '', climates: ['Temperate'], climateRaw: '', heightM: 4, widthM: 3, dims: '',
    targetRS: [3, 4], designRS: [1.5, 2], soil: '', soilTags: [], pruning: '', pruningTags: [], credit: '', creditLevel: '', note: '', ban: null,
    frostKillC: null, hardyC: null, emoji: '🌳', form: 'round', leaf: '#4f8a3a', deciduous: false, yearsToFruit: 0, yieldKg: 0,
    food: false, support: false, roles: [], natives: [], rare: false, dry: false, invasive: false, uses: [], varietyWindows: [],
    layer: 'medium', succession: 'secondary', lifespanYears: 30, pollard: false,
  }
}

type Result = { ok: true; value: LibSpecies } | { ok: false; errors: string[] }
const HEX = /^#[0-9a-f]{6}$/i

export function validateSpecies(input: unknown): Result {
  const e: string[] = []
  const x = (input ?? {}) as Record<string, any>
  const str = (k: string, max = 4000, required = false) => {
    const v = x[k] === undefined || x[k] === null ? '' : String(x[k]).trim()
    if (required && !v) e.push(`${k} is required`)
    if (v.length > max) e.push(`${k} is too long`)
    return v.slice(0, max)
  }
  const num = (k: string, min: number, max: number, fallback?: number) => {
    const v = x[k] === '' || x[k] === undefined || x[k] === null ? fallback : Number(x[k])
    if (v === undefined || !Number.isFinite(v)) {
      e.push(`${k} must be a number`)
      return min
    }
    if (v < min || v > max) e.push(`${k} must be between ${min} and ${max}`)
    return v
  }
  const optNum = (k: string, min: number, max: number) => (x[k] === '' || x[k] === undefined || x[k] === null ? undefined : num(k, min, max))
  const nullNum = (k: string, min: number, max: number) => (x[k] === '' || x[k] === undefined || x[k] === null ? null : num(k, min, max))
  const oneOf = <T extends string>(k: string, list: readonly T[], fallback?: T): T => {
    const v = (x[k] ?? fallback) as T
    if (!list.includes(v)) e.push(`${k} must be one of ${list.join(', ')}`)
    return v
  }
  const listOf = <T extends string>(k: string, allowed?: readonly T[]): T[] => {
    const v = x[k] ?? []
    if (!Array.isArray(v)) {
      e.push(`${k} must be a list`)
      return []
    }
    const out = [...new Set(v.map((s) => String(s).trim()).filter(Boolean))] as T[]
    if (allowed) for (const s of out) if (!allowed.includes(s)) e.push(`${k}: "${s}" isn't one of ${allowed.join(', ')}`)
    return out.slice(0, 40)
  }
  const bool = (k: string) => x[k] === true || x[k] === 'true'
  const pair = (k: string, min: number, max: number): [number, number] => {
    const v = x[k]
    if (!Array.isArray(v) || v.length !== 2) {
      e.push(`${k} must be two numbers (from, to)`)
      return [min, min]
    }
    const a = Number(v[0])
    const b = Number(v[1])
    if (![a, b].every(Number.isFinite) || a < min || b > max) e.push(`${k} must be two numbers between ${min} and ${max}`)
    else if (a > b) e.push(`${k}: the first number can't be bigger than the second`)
    return [a, b]
  }
  const month = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 12
  const window = (k: string): [number, number] | undefined => {
    const v = x[k]
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return undefined
    if (!Array.isArray(v) || v.length !== 2 || !v.every(month)) {
      e.push(`${k} must be two months, 1–12`)
      return undefined
    }
    return [Number(v[0]), Number(v[1])]
  }

  const name = str('name', 120, true)
  const code = oneOf('code', CODES)
  const id = str('id', 160) || (name ? speciesId(name, code) : '')
  if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id)) e.push('id may only use lowercase letters, numbers and dashes')
  const leaf = str('leaf', 7) || '#4f8a3a'
  if (!HEX.test(leaf)) e.push('leaf must be a colour like #4f8a3a')
  const fruit = str('fruit', 7) || undefined
  if (fruit && !HEX.test(fruit)) e.push('fruit must be a colour like #d94b4b')
  const varietyWindows = Array.isArray(x.varietyWindows) ? x.varietyWindows.filter((w: unknown) => Array.isArray(w) && w.length === 2 && w.every(month)).map((w: number[]) => [Number(w[0]), Number(w[1])] as [number, number]) : []

  const value: LibSpecies = {
    id, name, latin: str('latin', 160), code,
    strataNote: str('strataNote', 200) || undefined,
    lifecycle: oneOf('lifecycle', LIFECYCLES), phase: str('phase', 200),
    climates: listOf('climates', CLIMATES), climateRaw: str('climateRaw', 300),
    heightM: num('heightM', 0.05, 120), widthM: num('widthM', 0.05, 80), dims: str('dims', 300),
    targetRS: pair('targetRS', 0.05, 60), designRS: pair('designRS', 0.02, 60),
    soil: str('soil'), soilTags: listOf('soilTags'), pruning: str('pruning'), pruningTags: listOf('pruningTags'),
    credit: str('credit'), creditLevel: str('creditLevel', 60), note: str('note'), ban: str('ban', 1000) || null,
    frostKillC: nullNum('frostKillC', -60, 30), hardyC: nullNum('hardyC', -60, 30),
    emoji: str('emoji', 16) || '🌳', form: oneOf('form', FORMS), leaf, ...(fruit ? { fruit } : {}),
    deciduous: bool('deciduous'), yearsToFruit: num('yearsToFruit', 0, 100, 0), yieldKg: num('yieldKg', 0, 5000, 0),
    ...(window('harvest') ? { harvest: window('harvest') } : {}),
    ...(optNum('pricePerKg', 0, 1000) !== undefined ? { pricePerKg: optNum('pricePerKg', 0, 1000) } : {}),
    ...(optNum('zMin', 0, 14) !== undefined ? { zMin: optNum('zMin', 0, 14) } : {}),
    ...(optNum('zMax', 0, 14) !== undefined ? { zMax: optNum('zMax', 0, 14) } : {}),
    ...(optNum('zEdge', 0, 14) !== undefined ? { zEdge: optNum('zEdge', 0, 14) } : {}),
    ...(str('zEdgeNote', 300) ? { zEdgeNote: str('zEdgeNote', 300) } : {}),
    ...(optNum('chill', 0, 3000) !== undefined ? { chill: optNum('chill', 0, 3000) } : {}),
    food: bool('food'), support: bool('support'), roles: listOf('roles'), natives: listOf('natives', REGIONS),
    rare: bool('rare'), dry: bool('dry'), invasive: bool('invasive'), uses: listOf('uses'), varietyWindows,
    layer: oneOf('layer', LAYERS), succession: oneOf('succession', SUCCESSIONS), lifespanYears: num('lifespanYears', 1, 2000, 30), pollard: bool('pollard'),
  }
  if (value.zMin !== undefined && value.zMax !== undefined && value.zMin > value.zMax) e.push("zMin can't be warmer than zMax")
  return e.length ? { ok: false, errors: [...new Set(e)] } : { ok: true, value }
}
