import { reactive, ref } from 'vue'
import type { ClimateClass, Code, CodexClimate, LibSpecies, Lifecycle, Site } from '#shared/types'
import raw from '#shared/library.json'

// The species library: Byron Austin's Codex data cards joined with our species model (see scripts/build-library.ts).
// The app starts with this bundled copy; if a species database is connected (edited in /admin), its library is
// swapped in by setLibrary as soon as /api/species answers (plugins/library.client.ts).
export const LIBRARY = (raw as unknown as LibSpecies[]).slice()
export const libById = new Map(LIBRARY.map((s) => [s.id, s]))
export const libVersion = ref(0) // bumps when the library is swapped, so computed lists refresh
export const libSource = ref<'bundled' | 'db'>('bundled')

// Byron's designer ids its species sp_<name>_<strata>(_n) as it parses the same Codex file. Rebuilding his
// ids the same way lets design files move between his v13 designer and this one in both directions.
export const toByron = new Map<string, string>()
export const fromByron = new Map<string, string>()
function byronIds() {
  toByron.clear()
  fromByron.clear()
  const san = (x: string) => String(x).trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'syntropic-design'
  const seen = new Set<string>()
  for (const sp of LIBRARY) {
    const base = `sp_${san(sp.name).toLowerCase()}_${sp.code.toLowerCase()}`
    let id = base
    for (let n = 2; seen.has(id); n++) id = `${base}_${n}`
    seen.add(id)
    toByron.set(sp.id, id)
    fromByron.set(id, sp.id)
  }
}
byronIds()

export function setLibrary(list: LibSpecies[], source: 'bundled' | 'db') {
  if (!list.length) return
  const keep = { ...canopy }
  LIBRARY.splice(0, LIBRARY.length, ...list)
  libById.clear()
  for (const s of LIBRARY) libById.set(s.id, s)
  byronIds()
  libSource.value = source
  codexWidth.clear() // fresh objects: nothing to restore, just re-apply the design's overrides
  setCanopyOverrides(keep)
}

// Per-design canopy overrides, as in Byron's designer (his `canopyOverrides`): "in this design, my plums are
// managed to 4 m". Like his, they set the species' canopy width while the design is open; the Codex width is
// kept to restore. Every drawing, spacing and canopy rule reads widthM, so they all follow.
const codexWidth = new Map<string, number>()
export const canopy = reactive<Record<string, number>>({})
export function setCanopyOverrides(map: Record<string, number>) {
  for (const [id, w] of codexWidth) {
    const sp = libById.get(id)
    if (sp) sp.widthM = w
  }
  codexWidth.clear()
  for (const k of Object.keys(canopy)) delete canopy[k]
  for (const [id, v] of Object.entries(map)) {
    const sp = libById.get(id)
    if (!sp || !(Number(v) > 0)) continue
    codexWidth.set(id, sp.widthM)
    sp.widthM = Number(v)
    canopy[id] = Number(v)
  }
  libVersion.value++
}
export function setCanopy(id: string, v: number | null) {
  const next: Record<string, number> = { ...canopy }
  if (v === null || !(v > 0)) delete next[id]
  else next[id] = Math.round(v * 100) / 100
  setCanopyOverrides(next)
}
export const codexWidthOf = (sp: LibSpecies) => codexWidth.get(sp.id) ?? sp.widthM

export const STRATA: Record<Code, { name: string; color: string; wash: string; share: string }> = {
  E: { name: 'Emergent', color: '#8a6ad8', wash: '#d9ccf6', share: '~20% canopy' },
  H: { name: 'High', color: '#3f9a4a', wash: '#c9ecc0', share: '~40% canopy' },
  M: { name: 'Medium', color: '#3f7fc0', wash: '#c6dcf2', share: '~60% canopy' },
  L: { name: 'Low', color: '#c98a2a', wash: '#f6dfae', share: '~80% canopy' },
}
export const CODES: Code[] = ['E', 'H', 'M', 'L']
// Götsch / Codex canopy occupancy per stratum: the most of the land each layer's crowns should cover
export const OCCUPANCY: Record<Code, number> = { E: 0.2, H: 0.4, M: 0.6, L: 0.8 }

export const LIFECYCLE: Record<Lifecycle, { label: string; dash: number[]; width: number }> = {
  'Short': { label: 'Short · placenta, 1–2 yrs', dash: [3, 3], width: 1.4 },
  'Short-Medium': { label: 'Short-medium · pioneer support', dash: [8, 4], width: 1.6 },
  'Short-Perennial': { label: 'Short perennial · a decade or so', dash: [2, 2, 7, 2], width: 1.6 },
  'Medium': { label: 'Medium · secondary', dash: [], width: 1.6 },
  'Long': { label: 'Long · climax, decades', dash: [], width: 3 },
}

// The site's climate class in the Codex's four climates (arid sites read as Mediterranean "arid zones").
const CODEX_CLIMATE: Record<ClimateClass, CodexClimate> = {
  tropical: 'Tropical', subtropical: 'Subtropical', mediterranean: 'Mediterranean', arid: 'Mediterranean', temperate: 'Temperate', cold: 'Temperate',
}
const NEIGHBOURS: Record<CodexClimate, CodexClimate[]> = {
  Temperate: ['Mediterranean'], Mediterranean: ['Temperate', 'Subtropical'], Subtropical: ['Mediterranean', 'Tropical'], Tropical: ['Subtropical'],
}
export const codexClimate = (site: Site | null) => (site ? CODEX_CLIMATE[site.climate] : null)

export type FitLevel = 'good' | 'edge' | 'no'
export interface Fit { level: FitLevel; why: string }

// Will it grow here? The Codex's frost bans are absolute; zones (from the species model) come next, then the
// Codex climate tags. "edge" = worth trying with a good microclimate.
export function fitFor(sp: LibSpecies, site: Site | null): Fit {
  if (!site) return { level: 'good', why: '' }
  const minC = site.minTempC
  if (sp.frostKillC !== null && minC < sp.frostKillC - 1) return { level: 'no', why: `Killed below ${sp.frostKillC}°C; your coldest nights average ${Math.round(minC)}°C` }
  if (sp.hardyC !== null && minC < sp.hardyC - 2) return { level: 'no', why: `Hardy to ${sp.hardyC}°C; your coldest nights average ${Math.round(minC)}°C` }
  const zoneTxt = sp.zMin !== undefined ? `zones ${fmtZone(sp.zMin)}–${fmtZone(sp.zMax!)}` : ''
  if (sp.zMin !== undefined && sp.zMax !== undefined) {
    if (site.zone < sp.zMin - 0.5) return { level: 'no', why: `Needs ${zoneTxt}; you're in ${site.zoneLabel}` }
    if (site.zone > sp.zMax + 1) return { level: 'no', why: `Needs winter cold (${zoneTxt}); you're in ${site.zoneLabel}` }
    if (sp.chill && site.chillHours < sp.chill * 0.6) return { level: 'no', why: `Needs ~${sp.chill} chill hours; you get ~${site.chillHours}` }
    if (sp.zEdge !== undefined && site.zone < sp.zEdge) return { level: 'edge', why: `Zone ${site.zoneLabel} is at the cold edge: ${sp.zEdgeNote ?? 'choose the hardy types'}` }
    if (site.zone < sp.zMin || site.zone > sp.zMax) return { level: 'edge', why: `Edge of its range (${zoneTxt}); pick a sheltered spot` }
    if (sp.chill && site.chillHours < sp.chill) return { level: 'edge', why: `Low-chill varieties only (~${site.chillHours} h here)` }
  }
  if (sp.frostKillC !== null && minC < sp.frostKillC + 2) return { level: 'edge', why: `Frost-tender (dies below ${sp.frostKillC}°C): needs protection in your coldest spells` }
  const here = CODEX_CLIMATE[site.climate]
  if (!sp.climates.length || sp.climates.includes(here)) return { level: 'good', why: sp.zMin !== undefined ? `Suits ${here.toLowerCase()} zone ${site.zoneLabel}` : `A ${here.toLowerCase()} species` }
  if (sp.zMin !== undefined) return { level: 'good', why: `Grows in zone ${site.zoneLabel}` }
  if (sp.climates.some((c) => NEIGHBOURS[here].includes(c))) return { level: 'edge', why: `A ${sp.climates.join('/').toLowerCase()} species; trial it here` }
  return { level: 'no', why: `A ${sp.climates.join('/').toLowerCase()} species` }
}
export const fmtZone = (z: number) => `${Math.floor(z)}${z % 1 >= 0.5 ? 'b' : 'a'}`

// ── production (Byron's dashboard model, seeded with real yields where we have them) ──
const LC_TIMING: Record<Lifecycle, [number, number, number]> = { 'Short': [1, 1, 2], 'Short-Medium': [1, 2, 4], 'Short-Perennial': [1, 3, 14], 'Medium': [3, 6, 22], 'Long': [6, 12, 55] }
const LC_YFACTOR: Record<Lifecycle, number> = { 'Short': 1.4, 'Short-Medium': 1.1, 'Short-Perennial': 0.9, 'Medium': 1, 'Long': 1.1 }
export interface YieldCfg { first: number; peak: number; end: number; perPlant: number; price: number }

export function yieldDefaults(sp: LibSpecies, density = 0.6): YieldCfg {
  const [f, p, e] = LC_TIMING[sp.lifecycle]
  if (!sp.food) return { first: f, peak: p, end: e, perPlant: 0, price: 0 }
  if (sp.yieldKg > 0) {
    const first = sp.yearsToFruit || f
    return { first, peak: Math.max(first + 2, Math.round(first * 1.8)), end: Math.max(sp.lifespanYears, first + 3), perPlant: sp.yieldKg, price: sp.pricePerKg ?? 0 }
  }
  const area = Math.PI * (sp.widthM / 2) ** 2
  return { first: f, peak: p, end: e, perPlant: Math.max(0.1, Math.round(area * density * LC_YFACTOR[sp.lifecycle] * 10) / 10), price: 0 }
}
export function yieldAt(c: YieldCfg, y: number) {
  const first = c.first
  const peak = Math.max(c.peak, first)
  const end = Math.max(c.end, peak + 1)
  if (y < first) return 0
  if (y < peak) return c.perPlant * ((y - first + 1) / (peak - first + 1))
  const declineStart = Math.max(peak, end - Math.max(1, Math.round(end * 0.2)))
  if (y <= declineStart) return c.perPlant
  if (y <= end) return c.perPlant * (1 - (y - declineStart) / (end - declineStart))
  return 0
}

export function search(list: LibSpecies[], q: string) {
  const t = q.trim().toLowerCase()
  if (!t) return list
  return list.filter((s) => s.name.toLowerCase().includes(t) || s.latin.toLowerCase().includes(t))
}

// The Codex lists some species once per climate. In the picker we show the card that fits the site best.
export function bestCards(site: Site | null) {
  const here = codexClimate(site)
  const byName = new Map<string, LibSpecies>()
  for (const sp of LIBRARY) {
    const key = `${sp.name}|${sp.code}`
    const cur = byName.get(key)
    if (!cur || (here && sp.climates.includes(here) && !cur.climates.includes(here))) byName.set(key, sp)
  }
  return [...byName.values()]
}

// A managed crown never needs to be wider than the Codex Target RS (the spacing where a crop's crowns just meet).
export const managedWidth = (sp: Pick<LibSpecies, 'widthM' | 'targetRS'>) =>
  Math.max(0.2, Math.min(sp.widthM, 3 + sp.widthM * 0.45, Math.max((sp.targetRS[0] + sp.targetRS[1]) / 2, 0.3)))

// How close two plants may stand, as a share of their crowns' combined radii, by how many strata apart they are.
// Same layer: crowns just touch. A layer or two apart: a trunk shouldn't stand inside a neighbour's crown.
// Three apart (emergent over low): stacking is the point, so anything goes.
const CLEAR = [0.85, 0.7, 0.55, 0]
export const clearance = (a: LibSpecies, b: LibSpecies) => {
  const diff = Math.abs(CODES.indexOf(a.code) - CODES.indexOf(b.code))
  const reach = managedWidth(a) / 2 + managedWidth(b) / 2
  // herbs and ground cover live under and between everything else; only each other (and each other's trunks) are in the way
  if ((a.form === 'herb') !== (b.form === 'herb')) return reach * 0.15
  return reach * CLEAR[Math.min(diff, 3)]!
}
