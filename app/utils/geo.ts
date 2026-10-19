import type { Keyline, LL, Row } from '#shared/types'

// Planar geometry for designing on the map, ported from Byron Austin's Syntropic Planting Designer v13.
// Everything works in a local metre frame anchored at a lat/lng (x = east, y = north), then back to lat/lng.

export const R_EARTH = 111139 // m per degree of latitude
export interface XY { x: number; y: number }

export function frameAt(o: LL) {
  const k = Math.cos((o.lat * Math.PI) / 180)
  return {
    toM: (lat: number, lng: number): XY => ({ x: (lng - o.lng) * R_EARTH * k, y: (lat - o.lat) * R_EARTH }),
    toLL: (x: number, y: number): LL => ({ lat: o.lat + y / R_EARTH, lng: o.lng + x / (R_EARTH * k) }),
  }
}
export function llCentroid(pts: LL[]): LL {
  let la = 0
  let lo = 0
  for (const p of pts) { la += p.lat; lo += p.lng }
  return { lat: la / pts.length, lng: lo / pts.length }
}
export function polyAreaM2(pts: LL[]) {
  if (pts.length < 3) return 0
  const F = frameAt(llCentroid(pts))
  const m = pts.map((p) => F.toM(p.lat, p.lng))
  let a = 0
  for (let i = 0; i < m.length; i++) {
    const A = m[i]!
    const B = m[(i + 1) % m.length]!
    a += A.x * B.y - B.x * A.y
  }
  return Math.abs(a / 2)
}
export function longestEdgeAngle(pts: LL[]) {
  const F = frameAt(llCentroid(pts))
  const m = pts.map((p) => F.toM(p.lat, p.lng))
  let best = 0
  let bl = -1
  for (let i = 0; i < m.length; i++) {
    const a = m[i]!
    const b = m[(i + 1) % m.length]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > bl) { bl = len; best = Math.atan2(b.y - a.y, b.x - a.x) }
  }
  return ((best * 180) / Math.PI + 360) % 360
}

// ── straight rows: scanline fill of the boundary ──
function clipLineToPoly(P0: XY, d: XY, poly: XY[]) {
  const ts: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const det = ex * d.y - d.x * ey
    if (Math.abs(det) < 1e-9) continue
    const rx = a.x - P0.x
    const ry = a.y - P0.y
    const t = (-rx * ey + ex * ry) / det
    const s = (d.x * ry - d.y * rx) / det
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t)
  }
  ts.sort((x, y) => x - y)
  const uniq: number[] = []
  for (const t of ts) if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]!) > 1e-4) uniq.push(t)
  const ivs: [number, number][] = []
  for (let i = 0; i + 1 < uniq.length; i += 2) ivs.push([uniq[i]!, uniq[i + 1]!])
  return ivs
}
export function straightRows(boundary: LL[], dirDeg: number, spacing: number): Row[] {
  if (boundary.length < 3 || spacing <= 0) return []
  const F = frameAt(llCentroid(boundary))
  const poly = boundary.map((p) => F.toM(p.lat, p.lng))
  const th = (dirDeg * Math.PI) / 180
  const d = { x: Math.cos(th), y: Math.sin(th) }
  const perp = { x: -Math.sin(th), y: Math.cos(th) }
  let pmin = Infinity
  let pmax = -Infinity
  for (const pt of poly) {
    const pp = pt.x * perp.x + pt.y * perp.y
    pmin = Math.min(pmin, pp)
    pmax = Math.max(pmax, pp)
  }
  if ((pmax - pmin) / spacing > 4000) return []
  const rows: Row[] = []
  // centre the rows across the land so the margins match, and never put a row on the fence itself
  const rem = (pmax - pmin) % spacing
  const start = pmin + (rem < 1e-6 || spacing - rem < 1e-6 ? spacing : rem) / 2
  for (let p = start; p <= pmax; p += spacing) {
    const P0 = { x: perp.x * p, y: perp.y * p }
    for (const [t0, t1] of clipLineToPoly(P0, d, poly)) {
      if (t1 - t0 < 0.5) continue
      rows.push({ idx: rows.length, a: F.toLL(P0.x + d.x * t0, P0.y + d.y * t0), b: F.toLL(P0.x + d.x * t1, P0.y + d.y * t1) })
    }
  }
  return rows
}

// ── rows may be straight {a,b} or a keyline polyline {path} ──
export const rowPath = (r: Row): LL[] => (r.path && r.path.length >= 2 ? r.path : [r.a, r.b])
export function pathSampler(path: LL[]) {
  const o = path[0]!
  const k = Math.cos((o.lat * Math.PI) / 180)
  const M = path.map((p) => ({ x: (p.lng - o.lng) * R_EARTH * k, y: (p.lat - o.lat) * R_EARTH }))
  const cum = [0]
  for (let i = 0; i < M.length - 1; i++) cum.push(cum[i]! + Math.hypot(M[i + 1]!.x - M[i]!.x, M[i + 1]!.y - M[i]!.y))
  const total = cum[cum.length - 1]!
  const toLL = (x: number, y: number): LL => ({ lat: o.lat + y / R_EARTH, lng: o.lng + x / (R_EARTH * k) })
  return {
    total,
    at(d: number): LL {
      if (d <= 0) return toLL(M[0]!.x, M[0]!.y)
      if (d >= total) return toLL(M[M.length - 1]!.x, M[M.length - 1]!.y)
      let i = 0
      while (i < cum.length - 1 && cum[i + 1]! < d) i++
      const seg = cum[i + 1]! - cum[i]!
      const f = seg > 0 ? (d - cum[i]!) / seg : 0
      return toLL(M[i]!.x + (M[i + 1]!.x - M[i]!.x) * f, M[i]!.y + (M[i + 1]!.y - M[i]!.y) * f)
    },
  }
}

function nearestOnPath(F: ReturnType<typeof frameAt>, P: XY, path: LL[]) {
  const M = path.map((p) => F.toM(p.lat, p.lng))
  let best: XY | null = null
  let bd = Infinity
  for (let i = 0; i < M.length - 1; i++) {
    const A = M[i]!
    const B = M[i + 1]!
    const dx = B.x - A.x
    const dy = B.y - A.y
    const L2 = dx * dx + dy * dy
    let t = L2 > 0 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2 : 0
    t = Math.max(0, Math.min(1, t))
    const qx = A.x + t * dx
    const qy = A.y + t * dy
    const d = Math.hypot(P.x - qx, P.y - qy)
    if (d < bd) { bd = d; best = { x: qx, y: qy } }
  }
  return best ? { ...best, dist: bd } : null
}
// the nearest row within `reach` metres, and the snapped point on it
export function nearestRow(rows: Row[], ll: LL, reach: number) {
  const F = frameAt(ll)
  let best: { ll: LL; row: number; dist: number } | null = null
  for (const r of rows) {
    const n = nearestOnPath(F, { x: 0, y: 0 }, rowPath(r))
    if (n && n.dist <= reach && (!best || n.dist < best.dist)) best = { ll: F.toLL(n.x, n.y), row: r.idx, dist: n.dist }
  }
  return best
}

// ── point-in-poly, polyline clip & offset (metre frame) ──
export function pointInPoly(pt: XY, poly: XY[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x, yi = poly[i]!.y, xj = poly[j]!.x, yj = poly[j]!.y
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside
  }
  return inside
}
function clipPolylineToPolygon(pl: XY[], poly: XY[]) {
  const runs: XY[][] = []
  let cur: XY[] | null = null
  for (let s = 0; s < pl.length - 1; s++) {
    const A = pl[s]!
    const B = pl[s + 1]!
    const dx = B.x - A.x
    const dy = B.y - A.y
    const ts = [0, 1]
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i]!
      const Q = poly[(i + 1) % poly.length]!
      const ex = Q.x - P.x
      const ey = Q.y - P.y
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const t = ((P.x - A.x) * ey - (P.y - A.y) * ex) / den
      const u = ((P.x - A.x) * dy - (P.y - A.y) * dx) / den
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t)
    }
    ts.sort((a, b) => a - b)
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k]!
      const t1 = ts[k + 1]!
      if (t1 - t0 < 1e-7) continue
      const mt = (t0 + t1) / 2
      if (pointInPoly({ x: A.x + dx * mt, y: A.y + dy * mt }, poly)) {
        const p0 = { x: A.x + dx * t0, y: A.y + dy * t0 }
        const p1 = { x: A.x + dx * t1, y: A.y + dy * t1 }
        if (cur && Math.hypot(cur[cur.length - 1]!.x - p0.x, cur[cur.length - 1]!.y - p0.y) < 1e-4) cur.push(p1)
        else {
          if (cur) runs.push(cur)
          cur = [p0, p1]
        }
      } else if (cur) {
        runs.push(cur)
        cur = null
      }
    }
  }
  if (cur) runs.push(cur)
  return runs.filter((r) => r.length >= 2)
}
function lineIntersect(p1: XY, p2: XY, p3: XY, p4: XY) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(d) < 1e-9) return null
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}
function segIntersect(a: XY, b: XY, c: XY, d: XY) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? { x: a.x + t * rx, y: a.y + t * ry } : null
}
function densify(M: XY[], step: number) {
  if (M.length < 2) return M.map((p) => ({ ...p }))
  const out = [{ ...M[0]! }]
  for (let i = 0; i < M.length - 1; i++) {
    const a = M[i]!
    const b = M[i + 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n })
  }
  return out
}
// Parallel offset: each segment by its own normal, mitred, bevelled where a mitre would spike.
function offsetPolyline(M: XY[], dist: number) {
  const n = M.length
  if (n < 2) return M.map((p) => ({ ...p }))
  const A: XY[] = []
  const B: XY[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = M[i + 1]!.x - M[i]!.x
    const dy = M[i + 1]!.y - M[i]!.y
    const l = Math.hypot(dx, dy) || 1
    const nx = (dy / l) * dist
    const ny = (-dx / l) * dist
    A.push({ x: M[i]!.x + nx, y: M[i]!.y + ny })
    B.push({ x: M[i + 1]!.x + nx, y: M[i + 1]!.y + ny })
  }
  const out = [A[0]!]
  const limit = 1.8 * Math.abs(dist) + 0.05
  for (let i = 1; i < n - 1; i++) {
    const ip = lineIntersect(A[i - 1]!, B[i - 1]!, A[i]!, B[i]!)
    if (ip && Math.hypot(ip.x - M[i]!.x, ip.y - M[i]!.y) <= limit) out.push(ip)
    else out.push(B[i - 1]!, A[i]!)
  }
  out.push(B[n - 2]!)
  return out
}
// cut out the self-crossing loops on the inside of bends
function removeLoops(P: XY[]) {
  let changed = true
  let guard = 0
  while (changed && guard++ < 400) {
    changed = false
    for (let i = 0; i < P.length - 1 && !changed; i++) {
      for (let j = i + 2; j < P.length - 1; j++) {
        const ip = segIntersect(P[i]!, P[i + 1]!, P[j]!, P[j + 1]!)
        if (ip) { P.splice(i + 1, j - i, ip); changed = true; break }
      }
    }
  }
  return P
}
export function ptToPolylineDist(p: XY, M: XY[]) {
  let bd = Infinity
  for (let i = 0; i < M.length - 1; i++) {
    const a = M[i]!
    const b = M[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L2 = dx * dx + dy * dy
    let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0
    t = Math.max(0, Math.min(1, t))
    bd = Math.min(bd, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return bd
}

// Offset a keyline up- and down-slope at a fixed spacing until the region is covered; each offset becomes a row.
export function keylineRows(boundary: LL[], keyline: LL[], spacing: number, opts: { zone?: LL[]; includeBase?: boolean; existing?: Row[] } = {}) {
  const F = frameAt(llCentroid(boundary))
  const polyM = boundary.map((p) => F.toM(p.lat, p.lng))
  const useZone = (opts.zone?.length ?? 0) >= 3
  const regionM = useZone ? opts.zone!.map((p) => F.toM(p.lat, p.lng)) : polyM
  const baseM = keyline.map((p) => F.toM(p.lat, p.lng))
  // how far the region reaches from the keyline, at every vertex and edge midpoint (works for bent keylines)
  let maxD = 0
  for (let i = 0; i < regionM.length; i++) {
    const a = regionM[i]!
    const b = regionM[(i + 1) % regionM.length]!
    maxD = Math.max(maxD, ptToPolylineDist(a, baseM), ptToPolylineDist({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, baseM))
  }
  const kMax = Math.ceil(maxD / spacing) + 3
  if (kMax * 2 > 4000) return { rows: [] as { k: number; path: LL[] }[], tooFine: true }
  const baseDense = densify(baseM, Math.max(spacing, 3))
  const existingM = (opts.existing ?? []).map((r) => rowPath(r).map((p) => F.toM(p.lat, p.lng)))
  const rows: { k: number; path: LL[] }[] = []
  for (let k = -kMax; k <= kMax; k++) {
    if (k === 0 && opts.includeBase === false) continue
    let runs = clipPolylineToPolygon(removeLoops(offsetPolyline(baseDense, k * spacing)), regionM)
    if (useZone) runs = runs.flatMap((r) => clipPolylineToPolygon(r, polyM))
    for (const run of runs) {
      let len = 0
      for (let i = 0; i < run.length - 1; i++) len += Math.hypot(run[i + 1]!.x - run[i]!.x, run[i + 1]!.y - run[i]!.y)
      if (len < spacing * 0.5) continue
      if (existingM.length) {
        // skip a near-copy of a row that's already there
        const samples = [run[0]!, run[Math.floor(run.length / 2)]!, run[run.length - 1]!]
        if (samples.every((s) => existingM.some((em) => ptToPolylineDist(s, em) <= spacing * 0.4))) continue
      }
      rows.push({ k, path: run.map((pt) => F.toLL(pt.x, pt.y)) })
    }
  }
  rows.sort((a, b) => a.k - b.k)
  return { rows, tooFine: false }
}

// A/B rows: for keyline rows the offset level decides (keyline = A, then alternating outward), else the index.
export const rowAB = (r: Row) => ((((r.lvl ?? r.idx) % 2) + 2) % 2 === 0 ? 'A' : 'B')

// ── KML ──
function parseCoordStr(s: string): LL[] {
  const out: LL[] = []
  for (const tk of s.trim().split(/\s+/)) {
    const p = tk.split(',')
    if (p.length >= 2) {
      const lng = parseFloat(p[0]!)
      const lat = parseFloat(p[1]!)
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng })
    }
  }
  if (out.length > 1) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) out.pop()
  }
  return out
}
export function parseKMLPolys(text: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('that file is not valid KML')
  const out: { pts: LL[]; name: string; area: number }[] = []
  const polys = doc.getElementsByTagName('Polygon')
  for (let i = 0; i < polys.length; i++) {
    const pe = polys[i]!
    const coordsEl = pe.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0] ?? pe.getElementsByTagName('coordinates')[0]
    if (!coordsEl) continue
    const pts = parseCoordStr(coordsEl.textContent ?? '')
    let n: Node | null = pe
    while (n && (n as Element).tagName?.toLowerCase() !== 'placemark') n = n.parentNode
    const name = (n as Element | null)?.getElementsByTagName?.('name')[0]?.textContent?.trim() || `Polygon ${out.length + 1}`
    if (pts.length >= 3) out.push({ pts, name, area: polyAreaM2(pts) })
  }
  return out
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const KMLFIL = { E: '4ad47f9b', H: '4a52b84f', M: '4ad08b5a', L: '4a40a0e0' }
const KMLLN = { E: 'ffd47f9b', H: 'ff52b84f', M: 'ffd08b5a', L: 'ff40a0e0' }
export function buildKML(name: string, boundary: LL[], rows: Row[], lines: Keyline[], plants: { lat: number; lng: number; rowIdx: number; sp: { name: string; latin: string; code: 'E' | 'H' | 'M' | 'L'; lifecycle: string; widthM: number } }[]) {
  const c = (p: LL) => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`
  const ring = (lat: number, lng: number, rm: number) => {
    const pts: string[] = []
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2
      pts.push(c({ lat: lat + (Math.cos(a) * rm) / R_EARTH, lng: lng + (Math.sin(a) * rm) / (R_EARTH * Math.cos((lat * Math.PI) / 180)) }))
    }
    return pts.join(' ')
  }
  const plantPM = (p: (typeof plants)[number]) => `
    <Placemark><name>${esc(p.sp.name)}</name>
      <description><![CDATA[<b>${esc(p.sp.name)}</b> (${esc(p.sp.latin)})<br>Strata: ${p.sp.code} | Lifecycle: ${p.sp.lifecycle} | Canopy: ${p.sp.widthM}m | Row: ${p.rowIdx >= 0 ? p.rowIdx + 1 : 'free'}]]></description>
      <Style><PolyStyle><color>${KMLFIL[p.sp.code]}</color><outline>1</outline></PolyStyle><LineStyle><color>${KMLLN[p.sp.code]}</color><width>1</width></LineStyle></Style>
      <MultiGeometry><Point><coordinates>${c(p)}</coordinates></Point>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(p.lat, p.lng, p.sp.widthM / 2)}</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>`
  const byS = { E: [] as typeof plants, H: [] as typeof plants, M: [] as typeof plants, L: [] as typeof plants }
  for (const p of plants) byS[p.sp.code].push(p)
  const bnd = boundary.length >= 3
    ? `<Folder><name>Plot Boundary</name><Placemark><name>Boundary</name><Style><LineStyle><color>ff8a6a4a</color><width>2</width></LineStyle><PolyStyle><color>208a6a4a</color></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>${[...boundary, boundary[0]!].map(c).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${esc(name)}</name>
  ${bnd}
  <Folder><name>Rows</name>${rows.map((r) => `\n    <Placemark><name>Row ${r.idx + 1}</name><Style><LineStyle><color>645a4a8a</color><width>1</width></LineStyle></Style><LineString><coordinates>${rowPath(r).map(c).join(' ')}</coordinates></LineString></Placemark>`).join('')}</Folder>
  <Folder><name>Keylines</name>${lines.filter((l) => l.points.length >= 2).map((l) => `\n    <Placemark><name>Keyline</name><Style><LineStyle><color>${l.isOffset ? 'ff60a060' : 'ff80c040'}</color><width>2</width></LineStyle></Style><LineString><coordinates>${l.points.map(c).join(' ')}</coordinates></LineString></Placemark>`).join('')}</Folder>
  <Folder><name>Emergent (E)</name>${byS.E.map(plantPM).join('')}</Folder>
  <Folder><name>High (H)</name>${byS.H.map(plantPM).join('')}</Folder>
  <Folder><name>Medium (M)</name>${byS.M.map(plantPM).join('')}</Folder>
  <Folder><name>Low (L)</name>${byS.L.map(plantPM).join('')}</Folder>
</Document></kml>`
}

export function download(content: string, name: string, type: string) {
  const b = new Blob([content], { type })
  const u = URL.createObjectURL(b)
  const a = document.createElement('a')
  a.href = u
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 1200)
}
export const fileSafe = (s: string) => String(s ?? '').trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'food-forest'
