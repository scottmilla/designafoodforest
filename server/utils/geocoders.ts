import type { GeoResult, GeoSuggestion } from '../../shared/types'
import { esriPrecision, houseNumber, osmPrecision, PRECISION_RANK, simplifyAddress } from './addressText'
import { iso2, ISO2_TO_3 } from './iso3'

// Where an address is, from the services that know it best:
//   1. Esri's World Geocoder (the same company as the satellite photo). Real address points for the US, New Zealand
//      and most of the world, including rural addresses that OpenStreetMap doesn't have. Also does type-ahead.
//   2. OpenStreetMap (Nominatim), as a second opinion and a fallback when Esri is down.
// NUXT_ARCGIS_KEY (optional) is sent to Esri as the token; without it the free anonymous service is used, which
// is fine for a design tool but has terms for commercial use (see MAINTENANCE.md).

const ESRI = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer'
const esriAuth = () => {
  const key = useRuntimeConfig().arcgisKey
  return key ? { token: key } : {}
}
const osmHeaders = () => {
  const email = useRuntimeConfig().contactEmail
  return { 'User-Agent': `designafoodforest/0.2 (food forest designer${email ? '; ' + email : ''})` }
}

// OpenStreetMap asks for at most one request per second, per function instance
let last = 0
async function throttle() {
  const wait = last + 1000 - Date.now()
  last = Math.max(Date.now(), last + 1000) // reserve the next slot before waiting, so concurrent calls queue up
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
}

// ── Esri ──
interface EsriCand { address: string; location: { x: number; y: number }; score: number; extent?: { xmin: number; ymin: number; xmax: number; ymax: number }; attributes: Record<string, any> }
// the wider area in words, without repeats ("Auckland, Auckland, New Zealand" → "Auckland, New Zealand")
export function placeLine(...parts: (string | undefined)[]) {
  const out: string[] = []
  for (const p of parts) if (p && !out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p)
  return out.join(', ') || undefined
}

function fromEsri(c: EsriCand): GeoResult & { score: number } {
  const a = c.attributes
  const town = a.City || a.Nbrhd || a.Subregion || ''
  const short = a.StAddr || a.ShortLabel || a.PlaceName || c.address.split(',')[0]
  const label = [...new Set([short, town].filter(Boolean))].join(', ') || c.address
  const e = c.extent
  return {
    label,
    full: a.LongLabel || c.address,
    lat: c.location.y,
    lon: c.location.x,
    country: iso2(a.Country || a.CntryName || ''),
    precision: esriPrecision(a.Addr_type || ''),
    place: placeLine(a.Subregion, a.Region, a.CntryName || a.Country),
    ...(e ? { bbox: [e.ymin, e.ymax, e.xmin, e.xmax] as [number, number, number, number] } : {}),
    score: c.score,
  }
}
export async function esriFind(q: string, opts: { key?: string; max?: number } = {}) {
  const query = {
    f: 'json', outFields: 'Addr_type,StAddr,ShortLabel,PlaceName,LongLabel,City,Nbrhd,Subregion,Region,Country,CntryName', maxLocations: opts.max ?? 5,
    SingleLine: q, ...(opts.key ? { magicKey: opts.key } : {}), ...esriAuth(),
  }
  const r = await $fetch<{ candidates?: EsriCand[]; error?: unknown }>(`${ESRI}/findAddressCandidates`, { query, timeout: 8000 })
  if (r.error) throw new Error('esri error')
  return (r.candidates ?? []).map(fromEsri)
}
export async function esriSuggest(text: string, country?: string): Promise<GeoSuggestion[]> {
  const query = { f: 'json', maxSuggestions: 6, text, ...(country ? { countryCode: ISO2_TO_3.get(country) ?? country } : {}), ...esriAuth() }
  const r = await $fetch<{ suggestions?: { text: string; magicKey: string; isCollection: boolean }[] }>(`${ESRI}/suggest`, { query, timeout: 5000 })
  return (r.suggestions ?? []).filter((s) => !s.isCollection).map((s) => ({ text: s.text.replace(/, (USA|NZL|AUS|GBR|CAN)$/, ''), key: s.magicKey }))
}

// ── OpenStreetMap ──
function osmLabel(a: Record<string, string>, fallback: string) {
  const street = a.road ? `${a.house_number ? a.house_number + ' ' : ''}${a.road}` : ''
  const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || ''
  const region = a.state || a.region || ''
  return [...new Set([street || town || fallback.split(',')[0], street ? town : region].filter(Boolean))].slice(0, 2).join(', ') || fallback
}
export async function nominatim(q: string, max = 5): Promise<(GeoResult & { score: number })[]> {
  const params = new URLSearchParams({ format: 'jsonv2', limit: String(max), addressdetails: '1', q })
  await throttle()
  const hits = await $fetch<any[]>(`https://nominatim.openstreetmap.org/search?${params}`, { headers: osmHeaders(), timeout: 8000 })
  return hits.map((hit, i) => {
    const bb = (hit.boundingbox ?? []).map(Number)
    return {
      label: osmLabel(hit.address ?? {}, hit.name || hit.display_name),
      full: hit.display_name,
      lat: +hit.lat,
      lon: +hit.lon,
      country: String(hit.address?.country_code ?? '').toUpperCase(),
      precision: osmPrecision(hit.addresstype ?? hit.type ?? '', !!hit.address?.house_number),
      place: placeLine(hit.address?.county, hit.address?.state || hit.address?.region, hit.address?.country),
      ...(bb.length === 4 ? { bbox: bb as [number, number, number, number] } : {}),
      score: 80 - i * 5,
    }
  })
}
// Coordinates → the place they're in: town, county, state, country. Esri first, OpenStreetMap if it's down.
export async function reverse(lat: number, lon: number): Promise<{ label: string; full: string; country: string; place?: string } | null> {
  try {
    const r = await $fetch<any>(`${ESRI}/reverseGeocode`, { query: { f: 'json', location: `${lon},${lat}`, langCode: 'EN', ...esriAuth() }, timeout: 5000 })
    const a = r?.address
    if (a && (a.City || a.Subregion || a.Region)) {
      return {
        label: placeLine(a.City || a.Subregion, a.RegionAbbr && a.CountryCode === 'USA' ? a.RegionAbbr : a.Region)!,
        full: a.LongLabel || a.Match_addr || '',
        country: iso2(a.CountryCode || ''),
        place: placeLine(a.Subregion, a.Region, a.CntryName),
      }
    }
  } catch {
    /* fall through to OpenStreetMap */
  }
  try {
    const p = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '14', addressdetails: '1' })
    await throttle()
    const r = await $fetch<any>(`https://nominatim.openstreetmap.org/reverse?${p}`, { headers: osmHeaders(), timeout: 6000 })
    if (!r?.address) return null
    return {
      label: osmLabel(r.address, r.display_name), full: r.display_name as string, country: String(r.address.country_code ?? '').toUpperCase(),
      place: placeLine(r.address.county, r.address.state || r.address.region, r.address.country),
    }
  } catch {
    return null
  }
}

// ── putting them together ──
const near = (a: GeoResult, b: GeoResult) => Math.abs(a.lat - b.lat) < 0.0006 && Math.abs(a.lon - b.lon) < 0.0008

// Ask Esri first; if it has no house-level match, try the simplified address and OpenStreetMap too. Rank the
// answers by how precise they are (and whether the house number matches what was typed), then by score.
// `country` (the person's own, from their browser) only breaks near-ties: people often design land abroad.
export async function geocode(q: string, opts: { key?: string; country?: string } = {}) {
  const num = houseNumber(q)
  const all: (GeoResult & { score: number })[] = []
  const tryAdd = async (f: () => Promise<(GeoResult & { score: number })[]>) => {
    try {
      all.push(...(await f()))
    } catch {
      /* one service down is fine; the other may answer */
    }
  }
  const good = () => all.some((r) => r.precision === 'house' && r.score >= 90)
  await tryAdd(() => esriFind(q, { key: opts.key }))
  if (opts.key && all.length) return rank(all, num, opts.country)
  const simple = simplifyAddress(q)
  if (!good() && simple && simple !== q) await tryAdd(() => esriFind(simple))
  if (!good()) await tryAdd(() => nominatim(simple || q))
  return rank(all, num, opts.country)
}
function rank(all: (GeoResult & { score: number })[], num: string | null, country?: string) {
  for (const r of all) if (country && r.country === country) r.score += 2
  const typedNumber = (r: GeoResult) => (num && r.label.toLowerCase().startsWith(num + ' ') ? -1 : 0)
  const sorted = all
    .slice()
    .sort((a, b) => typedNumber(a) - typedNumber(b) || PRECISION_RANK[a.precision ?? 'region'] - PRECISION_RANK[b.precision ?? 'region'] || b.score - a.score)
  const out: GeoResult[] = []
  for (const { score, ...r } of sorted) if (!out.some((o) => near(o, r))) out.push(r)
  return out
}
