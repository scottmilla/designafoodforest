import type { Site, Weather } from '#shared/types'

// Everything the scene needs to paint today's sky at the person's place: light, warmth of the hour,
// cloud, precipitation and season. Recomputed every minute from the site's local clock.
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export interface Env {
  day: number // 0 night → 1 full day
  dusk: number // 0..1 glow around sunrise/sunset
  overcast: number // 0..1
  rain: number // 0..1
  snow: number // 0..1
  fog: number
  season: Season
  lush: boolean // tropics: always green
  arid: boolean
  sunElev: number // radians
  sunAz: number // radians, 0 = south (+z)
  hour: number
  month: number // 1..12 local
  label: string // "Clear", "Light rain" ...
  icon: string
}

const hourOf = (iso: string) => {
  const t = iso.split('T')[1] ?? '12:00'
  const [h, m] = t.split(':').map(Number)
  return (h ?? 12) + (m ?? 0) / 60
}

export function weatherLabel(code: number): [string, string] {
  if (code === 0) return ['Clear', '☀️']
  if (code <= 2) return ['Partly cloudy', '⛅']
  if (code === 3) return ['Overcast', '☁️']
  if (code === 45 || code === 48) return ['Fog', '🌫️']
  if (code >= 51 && code <= 57) return ['Drizzle', '🌦️']
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['Rain', '🌧️']
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['Snow', '🌨️']
  if (code >= 95) return ['Thunderstorm', '⛈️']
  return ['Fair', '🌤️']
}

export function localNow(w: Weather | null) {
  // the site's wall clock, ticking forward from when we fetched it
  const now = new Date(Date.now() + (w?.utcOffsetSeconds ?? -new Date().getTimezoneOffset() * 60) * 1000)
  return { hour: now.getUTCHours() + now.getUTCMinutes() / 60, month: now.getUTCMonth() + 1, day: now.getUTCDate() }
}

export function seasonFor(month: number, south: boolean): Season {
  const m = south ? ((month + 5) % 12) + 1 : month
  return m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// The twelve months with the sign of the zodiac the sun is in for most of each (tropical zodiac).
// Each glyph carries U+FE0E so it draws as a plain text symbol, not a coloured emoji tile.
export const ZODIAC: { glyph: string; name: string }[] = [
  { glyph: '♑\uFE0E', name: 'Capricorn' }, { glyph: '♒\uFE0E', name: 'Aquarius' }, { glyph: '♓\uFE0E', name: 'Pisces' }, { glyph: '♈\uFE0E', name: 'Aries' },
  { glyph: '♉\uFE0E', name: 'Taurus' }, { glyph: '♊\uFE0E', name: 'Gemini' }, { glyph: '♋\uFE0E', name: 'Cancer' }, { glyph: '♌\uFE0E', name: 'Leo' },
  { glyph: '♍\uFE0E', name: 'Virgo' }, { glyph: '♎\uFE0E', name: 'Libra' }, { glyph: '♏\uFE0E', name: 'Scorpio' }, { glyph: '♐\uFE0E', name: 'Sagittarius' },
]

// monthOverride: the season slider in the forest. A chosen month shows that month's typical sky (fair, with snow
// lying in winter where the site's winters are hard) instead of today's live weather.
export function computeEnv(site: Site | null, w: Weather | null, forceDay = false, monthOverride: number | null = null): Env {
  const live = localNow(w)
  const hour = live.hour
  const month = monthOverride ?? live.month
  const preview = monthOverride !== null
  const rise = w ? hourOf(w.sunrise) : 6.5
  const set = w ? hourOf(w.sunset) : 18.5
  const h = forceDay ? 13 : hour
  const day = smooth(rise - 0.6, rise + 0.8, h) * (1 - smooth(set - 0.8, set + 0.6, h))
  const dusk = forceDay ? 0 : Math.max(Math.exp(-((h - rise) ** 2) / 0.7), Math.exp(-((h - set) ** 2) / 0.7))
  const code = forceDay ? 0 : preview ? 1 : (w?.code ?? 1)
  const [label, icon] = weatherLabel(code)
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 ? (code >= 63 || code >= 81 ? 1 : 0.5) : 0
  const south = (site?.lat ?? 40) < 0
  const hardWinter = preview && seasonFor(month, south) === 'winter' && (site?.minTempC ?? 0) < -9 && site?.climate !== 'arid'
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86 ? 1 : hardWinter ? 0.5 : 0
  const overcast = Math.min(1, Math.max(forceDay || preview ? 0 : (w?.cloud ?? 30) / 100 - 0.2, rain || snow ? 0.8 : 0, code === 3 ? 0.75 : 0) * 1)
  const lat = Math.abs(site?.lat ?? 40)
  const dayFrac = Math.min(1, Math.max(0, (h - rise) / Math.max(1, set - rise)))
  const decl = 23.4 * Math.cos(((month - 6.5) / 12) * Math.PI * 2) * (south ? -1 : 1)
  const noon = (90 - Math.abs(lat - decl)) * (Math.PI / 180)
  return {
    day, dusk, overcast, rain, snow,
    fog: code === 45 || code === 48 ? 1 : 0,
    season: seasonFor(month, south),
    lush: site?.climate === 'tropical' || (site?.zone ?? 0) >= 10.5,
    arid: site?.climate === 'arid',
    sunElev: Math.max(0.12, Math.sin(dayFrac * Math.PI) * noon),
    sunAz: (dayFrac - 0.5) * Math.PI * (south ? -1 : 1),
    hour: h, month, label, icon,
  }
}
