// Numbers for people: imperial where the site is (US, Liberia, Myanmar), metric everywhere else, unless the
// person picks a system with the m / ft toggle (ui.units in useDesign).
export const fmtTemp = (c: number, imperial: boolean) => (imperial ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`)
export const fmtLen = (m: number, imperial: boolean) => {
  if (!imperial) return m < 1 ? `${Math.round(m * 100)} cm` : `${Math.round(m * 10) / 10} m`
  const ft = m * 3.281
  return ft < 3 ? `${Math.round(ft * 12)} in` : `${Math.round(ft)} ft`
}
// spacing ranges: the Codex writes them in metres, so imperial shows feet first with the Codex metres alongside
export const fmtRange = (r: [number, number], imperial: boolean) => {
  const m = r[0] === r[1] ? `${r[0]} m` : `${r[0]}–${r[1]} m`
  if (!imperial) return m
  const inch = r[1] * 3.281 < 3 // pick one unit for both ends
  const n = (x: number) => (inch ? Math.round(x * 39.37) : Math.round(x * 3.281))
  const u = inch ? 'in' : 'ft'
  return `${n(r[0]) === n(r[1]) ? n(r[0]) : `${n(r[0])}–${n(r[1])}`} ${u} (${m})`
}
export const fmtMass = (kg: number, imperial: boolean) => {
  const v = imperial ? kg * 2.20462 : kg
  const u = imperial ? 'lb' : 'kg'
  return v >= 10000 ? `${Math.round(v / 1000).toLocaleString()}k ${u}` : `${v >= 10 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10} ${u}`
}
export const fmtMoney = (usd: number) => '$' + (usd >= 10000 ? Math.round(usd / 1000) + 'k' : Math.round(usd).toLocaleString())
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// harvest windows are stored for the Northern Hemisphere
export const fmtWindow = (h: [number, number] | undefined, south = false) => {
  if (!h) return '—'
  const s = (m: number) => (south ? ((m + 5) % 12) + 1 : m)
  const [a, b] = [s(h[0]), s(h[1])]
  return a === b ? MONTH_NAMES[a - 1]! : `${MONTH_NAMES[a - 1]}–${MONTH_NAMES[b - 1]}`
}

// a length typed or slid by the person, in their units: metres stay metres, imperial is whole-ish feet
export const FT = 3.28084
export const lenUnit = (imperial: boolean) => (imperial ? 'ft' : 'm')
export const toUnit = (m: number, imperial: boolean) => (imperial ? Math.round(m * FT * 10) / 10 : Math.round(m * 100) / 100)
export const fromUnit = (v: number, imperial: boolean) => (imperial ? v / FT : v)
// a spacing for labels and messages: "4 m" or "13 ft"
export const fmtDist = (m: number, imperial: boolean) => (imperial ? `${Math.round(m * FT)} ft` : `${Math.round(m * 10) / 10} m`)
export const fmtSpan = (a: number, b: number, imperial: boolean) => {
  const f = (m: number) => (imperial ? Math.round(m * FT) : Math.round(m * 10) / 10)
  return f(a) === f(b) ? `${f(a)} ${lenUnit(imperial)}` : `${f(a)}–${f(b)} ${lenUnit(imperial)}`
}
