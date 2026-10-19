// Contract shared by the app, the server and the species-library build script.

export type Region =
  | 'na-east' | 'na-west' | 'na-southwest' | 'mesoamerica' | 'caribbean'
  | 'sa-tropical' | 'sa-temperate' | 'europe' | 'mediterranean' | 'africa'
  | 'asia-east' | 'asia-south' | 'oceania'

export type ClimateClass = 'tropical' | 'subtropical' | 'mediterranean' | 'arid' | 'temperate' | 'cold'

export interface Site {
  label: string // "Indian Head, MD"
  country: string // ISO-2, upper case
  lat: number
  lon: number
  region: Region
  zone: number // USDA zone, half zones as .5 (7.5 = 7b)
  zoneLabel: string // "7b"
  climate: ClimateClass
  minTempC: number // mean annual extreme minimum
  meanTempC: number
  precipMm: number
  frostFreeDays: number
  chillHours: number
  dryMonths: number // months with < 40 mm
  hemisphere: 'N' | 'S'
  estimated?: boolean // climate guessed from latitude because the archive was unreachable
}

export interface Weather {
  tempC: number
  code: number // WMO weather code
  isDay: boolean
  cloud: number
  wind: number
  localTime: string // ISO, at the site
  utcOffsetSeconds: number
  sunrise: string
  sunset: string
}

// GET /api/geocode: where the address is (fast), so the map can fly there before the climate is read
export interface GeoResult {
  label: string // short, e.g. "Eden Canyon Rd, Castro Valley"
  full: string // the geocoder's full display name
  lat: number
  lon: number
  country: string
  bbox?: [number, number, number, number] // south, north, west, east
}

// GET /api/climate: ten years of sky at a point, plus right now
export interface ClimateResult {
  site: Site
  weather: Weather | null
}

// ── species ─────────────────────────────────────────────────────────────────
// The Codex's four strata letters, plus the 3D scene's layer names (which add 'ground').
export type Code = 'E' | 'H' | 'M' | 'L'
export type Strata = 'emergent' | 'high' | 'medium' | 'low' | 'ground'
export type Succession = 'placenta' | 'secondary' | 'climax'
export type Form = 'round' | 'spreading' | 'columnar' | 'conifer' | 'palm' | 'shrub' | 'pollard' | 'vine' | 'herb'
export type Lifecycle = 'Short' | 'Short-Medium' | 'Short-Perennial' | 'Medium' | 'Long'
export type CodexClimate = 'Temperate' | 'Mediterranean' | 'Subtropical' | 'Tropical'

// One Codex data card (Byron Austin's Food-Forestry Codex, VOL2_4), joined with the horticultural and
// visual data from our own species model (zones, yields, harvest months, colours, plant form).
export interface LibSpecies {
  id: string
  name: string
  latin: string
  code: Code // Codex strata
  strataNote?: string // "managed to H", "E → H"…
  lifecycle: Lifecycle
  phase: string // "Mid Secondary → Late Secondary"
  climates: CodexClimate[]
  climateRaw: string
  heightM: number
  widthM: number // canopy diameter, mature
  dims: string // the card's dimensions line, as written
  targetRS: [number, number] // in-row spacing as a target crop, m
  designRS: [number, number] // 50% of target: the Codex's overplanting density
  soil: string
  soilTags: string[]
  pruning: string
  pruningTags: string[]
  credit: string // succession credit
  creditLevel: string // High / Moderate / Low…
  note: string // technical note
  ban: string | null // ⚠️ hard ban text
  frostKillC: number | null // dies below this (from the hard ban), °C
  hardyC: number | null // stated hardiness, °C
  // joined from the species model (null where the Codex species isn't in it)
  emoji: string
  form: Form
  leaf: string
  fruit?: string
  deciduous: boolean
  yearsToFruit: number // 0 = not grown for a harvest
  yieldKg: number // mature, per plant per year
  harvest?: [number, number] // months, Northern Hemisphere
  pricePerKg?: number
  zMin?: number // the hardiest members of the group
  zMax?: number
  zEdge?: number // typical members need this zone or warmer; colder sites need the hardy ones named in zEdgeNote
  zEdgeNote?: string
  chill?: number
  food: boolean // grown for something to eat
  support: boolean // biomass / nitrogen / pioneer role
  // what the suggestion engine needs (from the species model; empty where the Codex species isn't in it)
  roles: string[] // fruit, berry, nut, timber, support, nfix, biomass, flower, wildlife, herb …
  natives: Region[] // regions it is native to
  rare: boolean // collector / unusual fruit
  dry: boolean // copes with a long dry season
  invasive: boolean
  uses: string[] // herb layer: culinary, tea, medicinal, pollinator, aromatic
  varietyWindows: [number, number][] // harvest windows of its varieties (northern months), to stretch the season
  // derived for the 3D growth model
  layer: Strata
  succession: Succession
  lifespanYears: number
  pollard: boolean
}

// ── the design (Byron's v13 data model, kept compatible with his JSON) ──────
export interface LL { lat: number; lng: number }
export interface Row { idx: number; a: LL; b: LL; path?: LL[]; lvl?: number }
export interface Plant { id: string; speciesId: string; lat: number; lng: number; rowIdx: number }
export interface Keyline { id: string; points: LL[]; isContour: boolean; isOffset: boolean }

export interface PlotData {
  boundary: LL[]
  fillZone: LL[]
  rowDir: number // degrees, 0 = east
  rowSpacing: number // m
  rows: Row[]
  plants: Plant[]
  lines: Keyline[]
}
