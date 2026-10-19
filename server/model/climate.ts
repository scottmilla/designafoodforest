import type { ClimateClass, Region } from '../../shared/types'

// USDA hardiness: 10 °F bands of average annual extreme minimum, split into a/b halves.
// Zone 1a starts at -60 °F. Returns e.g. 7.5 for 7b.
export function usdaZone(minTempC: number) {
  const f = minTempC * 9 / 5 + 32
  const half = Math.floor((f + 60) / 5) // 0 = 1a, 1 = 1b, ...
  const z = Math.max(0, Math.min(25, half))
  return 1 + z / 2
}
export function zoneLabel(zone: number) {
  const whole = Math.floor(zone)
  return `${whole}${zone - whole >= 0.5 ? 'b' : 'a'}`
}

export interface DailySeries {
  time: string[]
  tmin: (number | null)[]
  tmax: (number | null)[]
  precip: (number | null)[]
}

export interface ClimateSummary {
  minTempC: number
  meanTempC: number
  precipMm: number
  frostFreeDays: number
  chillHours: number
  dryMonths: number
  coldestMonthC: number
  warmestMonthC: number
  summerDry: boolean
}

// Turn ~10 years of daily history into the handful of numbers a designer cares about.
export function summarise(d: DailySeries, lat: number): ClimateSummary {
  const yearMin = new Map<number, number>()
  const monthT = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }))
  const monthP = Array.from({ length: 12 }, () => 0)
  const years = new Set<number>()
  let frostFree = 0
  let chill = 0
  let sum = 0
  let n = 0
  let precip = 0
  const south = lat < 0
  for (let i = 0; i < d.time.length; i++) {
    const lo = d.tmin[i]
    const hi = d.tmax[i]
    if (lo == null || hi == null) continue
    const date = d.time[i]!
    const y = +date.slice(0, 4)
    const m = +date.slice(5, 7) - 1
    years.add(y)
    yearMin.set(y, Math.min(yearMin.get(y) ?? Infinity, lo))
    const mean = (lo + hi) / 2
    monthT[m]!.sum += mean
    monthT[m]!.n++
    monthP[m]! += d.precip[i] ?? 0
    precip += d.precip[i] ?? 0
    sum += mean
    n++
    if (lo > 0) frostFree++
    // chill hours below 7.2 °C over the dormant season, assuming a linear daily temperature ramp
    const dormant = south ? m >= 4 && m <= 7 : m >= 10 || m <= 1
    if (dormant) chill += hi <= 7.2 ? 24 : lo >= 7.2 ? 0 : (24 * (7.2 - lo)) / (hi - lo)
  }
  const ny = Math.max(1, years.size)
  const mins = [...yearMin.values()]
  const monthMeans = monthT.map((t) => (t.n ? t.sum / t.n : 0))
  const monthPrecip = monthP.map((p) => p / ny)
  const summer = south ? [11, 0, 1] : [5, 6, 7]
  const winter = south ? [5, 6, 7] : [11, 0, 1]
  const sP = summer.reduce((a, m) => a + monthPrecip[m]!, 0)
  const wP = winter.reduce((a, m) => a + monthPrecip[m]!, 0)
  return {
    minTempC: mins.reduce((a, b) => a + b, 0) / Math.max(1, mins.length),
    meanTempC: sum / Math.max(1, n),
    precipMm: precip / ny,
    frostFreeDays: Math.round(frostFree / ny),
    chillHours: Math.round(chill / ny),
    dryMonths: monthPrecip.filter((p) => p < 40).length,
    coldestMonthC: Math.min(...monthMeans),
    warmestMonthC: Math.max(...monthMeans),
    summerDry: sP < wP / 3 && sP < 90,
  }
}

// Last-resort guess from latitude alone when the climate archive is unreachable. Flagged as estimated in the UI.
export function estimateClimate(lat: number): ClimateSummary {
  const a = Math.max(0, Math.abs(lat) - 12)
  const mean = 27 - 0.45 * a
  return {
    minTempC: 16 - 1.2 * a, meanTempC: mean, precipMm: 1000, frostFreeDays: Math.round(Math.max(90, Math.min(365, 365 - 8 * Math.max(0, Math.abs(lat) - 25)))),
    chillHours: Math.abs(lat) < 25 ? 0 : Math.min(2000, Math.round((Math.abs(lat) - 25) * 90)), dryMonths: 0,
    coldestMonthC: mean - 0.5 * a, warmestMonthC: mean + 0.3 * a, summerDry: false,
  }
}

export function climateClass(c: ClimateSummary, zone: number): ClimateClass {
  if (c.coldestMonthC >= 18) return 'tropical'
  if (c.precipMm < 400) return 'arid'
  if (c.summerDry && zone >= 8) return 'mediterranean'
  if (zone >= 9) return 'subtropical'
  if (zone <= 5) return 'cold'
  return 'temperate'
}

// Coarse native-flora regions. Good enough to pick a native palette; a designer refines from there.
export function regionFor(lat: number, lon: number, country = ''): Region {
  const cc = country.toUpperCase()
  if (['GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA'].includes(cc)) return 'mesoamerica'
  if (['CU', 'JM', 'HT', 'DO', 'PR', 'BS', 'TT', 'BB', 'LC', 'GD', 'VC', 'DM', 'AG', 'KN'].includes(cc)) return 'caribbean'
  if (cc === 'MX') return lat > 24 ? 'na-southwest' : 'mesoamerica'
  if (['AU', 'NZ', 'PG', 'FJ'].includes(cc)) return 'oceania'
  if (lon > -170 && lon < -50 && lat > 14) {
    // North America: west of the Rockies is "west", the dry south-west its own
    if (lon < -114 || (lon < -104 && lat > 42)) return lat < 36 && lon > -121 ? 'na-southwest' : 'na-west'
    if (lon < -97 && lat < 38) return 'na-southwest'
    return 'na-east'
  }
  if (lon > -95 && lon < -30 && lat <= 14) return lat < -23 ? 'sa-temperate' : 'sa-tropical'
  if (lon > -30 && lon < 50 && lat > 30 && lat < 46 && !(lat > 44 && lon < 0)) return 'mediterranean'
  if (lon > -30 && lon < 60 && lat >= 46) return 'europe'
  if (lon > -20 && lon < 55 && lat <= 30) return 'africa'
  if (lon >= 60 && lat < 28) return 'asia-south'
  if (lon >= 60) return lat < 0 ? 'oceania' : 'asia-east'
  if (lon > 110 && lat < -10) return 'oceania'
  return 'na-east'
}
