// Numbers for people: imperial where the site is (US, Liberia, Myanmar), metric everywhere else.
export const fmtTemp = (c: number, imperial: boolean) => (imperial ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`)
export const fmtLen = (m: number, imperial: boolean) => {
  if (!imperial) return m < 1 ? `${Math.round(m * 100)} cm` : `${Math.round(m * 10) / 10} m`
  const ft = m * 3.281
  return ft < 3 ? `${Math.round(ft * 12)} in` : `${Math.round(ft)} ft`
}
// spacing ranges read best in both units for practitioners used to metres: "4–6 m (13–20 ft)"
export const fmtRange = (r: [number, number], imperial: boolean) => {
  const m = r[0] === r[1] ? `${r[0]} m` : `${r[0]}–${r[1]} m`
  if (!imperial) return m
  const f = (x: number) => (x * 3.281 < 3 ? `${Math.round(x * 39.37)}″` : `${Math.round(x * 3.281)}′`)
  return `${m} (${r[0] === r[1] ? f(r[0]) : `${f(r[0])}–${f(r[1])}`})`
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
