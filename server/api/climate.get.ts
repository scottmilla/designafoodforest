import type { ClimateResult, Site } from '../../shared/types'
import { climateClass, estimateClimate, regionFor, summarise, usdaZone, zoneLabel, type ClimateSummary } from '../model/climate'

// GET /api/climate?lat=..&lon=..&label=..&country=..
// Ten years of daily history (Open-Meteo archive) → hardiness zone, rain, frost-free days, chill hours,
// climate class; plus right-now weather to paint today's sky in the 3D view.

async function archive(lat: number, lon: number, years: number, timeout: number) {
  const end = new Date(Date.UTC(new Date().getUTCFullYear() - 1, 11, 31))
  const start = new Date(Date.UTC(end.getUTCFullYear() - (years - 1), 0, 1))
  const d = (x: Date) => x.toISOString().slice(0, 10)
  const r = await $fetch<any>('https://archive-api.open-meteo.com/v1/archive', {
    query: { latitude: lat, longitude: lon, start_date: d(start), end_date: d(end), daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum', timezone: 'auto' },
    timeout,
  })
  return summarise({ time: r.daily.time, tmin: r.daily.temperature_2m_min, tmax: r.daily.temperature_2m_max, precip: r.daily.precipitation_sum }, lat)
}

// 10 years → 3 years → (archive down) a rough latitude estimate, so the designer never dead-ends
const climateFor = defineCachedFunction(
  async (lat: number, lon: number): Promise<ClimateSummary & { estimated?: boolean }> => {
    try {
      return await archive(lat, lon, 10, 12000)
    } catch {
      try {
        return await archive(lat, lon, 3, 8000)
      } catch {
        return { ...estimateClimate(lat), estimated: true }
      }
    }
  },
  {
    maxAge: 60 * 60 * 24 * 30, name: 'climate', getKey: (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`,
    validate: (entry: any) => !entry?.value?.estimated, // never cache a guess for a month
  } as any,
)

export default defineEventHandler(async (event): Promise<ClimateResult> => {
  rateLimit(event, 'climate', 20)
  const q = getQuery(event)
  const lat = Number(q.lat)
  const lon = Number(q.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw createError({ statusCode: 400, statusMessage: 'lat and lon are required' })
  const country = String(q.country ?? '').slice(0, 2).toUpperCase()
  const label = String(q.label ?? '').slice(0, 120) || `${lat.toFixed(3)}, ${lon.toFixed(3)}`
  const [c, weather] = await Promise.all([climateFor(lat, lon), weatherFor(lat, lon)])
  const zone = usdaZone(c.minTempC)
  const site: Site = {
    label, country, lat, lon,
    region: regionFor(lat, lon, country),
    zone, zoneLabel: zoneLabel(zone), climate: climateClass(c, zone),
    minTempC: Math.round(c.minTempC * 10) / 10, meanTempC: Math.round(c.meanTempC * 10) / 10, precipMm: Math.round(c.precipMm),
    frostFreeDays: c.frostFreeDays, chillHours: c.chillHours, dryMonths: c.dryMonths, hemisphere: lat < 0 ? 'S' : 'N',
    ...(c.estimated ? { estimated: true } : {}),
  }
  return { site, weather }
})
