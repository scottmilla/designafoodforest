import type { LibSpecies, LL, Plant, PlotData } from '#shared/types'
import { frameAt, llCentroid, rowAB, rowPath } from './geo'
import { CODES, LIFECYCLE, STRATA, type FitLevel } from './library'

// Paints the design over the satellite photo: soft lasur washes for canopies, a cream rope for the
// boundary, mulch bands for rows. Byron's information is all here (strata colour, lifecycle line,
// true canopy size); it just looks like it was painted rather than plotted.

export interface PaintState {
  plot: PlotData
  others: { name: string; data: PlotData }[] // the other visible plots: drawn faded, behind, tap one to edit it
  lib: Map<string, LibSpecies>
  fits: Map<string, { level: FitLevel }>
  labels: boolean
  showSupport: boolean
  tool: string
  step: string
  drawPts: LL[]
  orientPts: LL[]
  mouse: LL | null
  ghost: { sp: LibSpecies; at: LL } | null
  focusRow: number | null
  inspect: string | null
}

type Pt = { x: number; y: number }
const hexA = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const INK = '#3b2a1a'
const CREAM = '#fff8e8'

export function paint(ctx: CanvasRenderingContext2D, W: number, H: number, P: (ll: LL) => Pt, mpp: number, st: PaintState) {
  ctx.clearRect(0, 0, W, H)
  const { plot } = st
  const line = (pts: LL[], close = false) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const q = P(p)
      if (i) ctx.lineTo(q.x, q.y)
      else ctx.moveTo(q.x, q.y)
    })
    if (close) ctx.closePath()
  }

  // ── the other plots: a faded sketch of each, with its name ──
  for (const o of st.others) {
    const od = o.data
    ctx.globalAlpha = 0.55
    for (const r of od.rows) {
      line(rowPath(r))
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.5)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const p of od.plants) {
      const sp = st.lib.get(p.speciesId)
      if (!sp || (p.role === 'support' && !st.showSupport)) continue
      const q = P(p)
      if (q.x < -60 || q.x > W + 60 || q.y < -60 || q.y > H + 60) continue
      const r = Math.max(1.5, ((p.role === 'support' ? 0.35 : 0.5) * sp.widthM) / mpp)
      ctx.beginPath()
      ctx.arc(q.x, q.y, r, 0, 7)
      ctx.fillStyle = hexA(STRATA[sp.code].wash, 0.35)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = hexA(STRATA[sp.code].color, 0.6)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (od.boundary.length >= 3) {
      line(od.boundary, true)
      ctx.fillStyle = 'rgba(255, 248, 232, 0.06)'
      ctx.fill()
      ctx.strokeStyle = hexA(INK, 0.5)
      ctx.lineWidth = 3.5
      ctx.stroke()
      ctx.strokeStyle = 'rgba(242, 230, 200, 0.75)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
      const c = P(llCentroid(od.boundary))
      ctx.font = '700 13px Alegreya, Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3.5
      ctx.strokeStyle = hexA(INK, 0.85)
      ctx.lineJoin = 'round'
      ctx.strokeText(o.name, c.x, c.y)
      ctx.fillStyle = CREAM
      ctx.fillText(o.name, c.x, c.y)
    }
  }

  // ── land: a warm glaze inside, a rope on stakes around it ──
  if (plot.boundary.length >= 3) {
    line(plot.boundary, true)
    ctx.fillStyle = 'rgba(255, 233, 168, 0.10)'
    ctx.fill()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = hexA(INK, 0.75)
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = '#f2e6c8'
    ctx.lineWidth = 2.5
    ctx.setLineDash([9, 5])
    ctx.stroke()
    ctx.setLineDash([])
    for (const p of plot.boundary) {
      const q = P(p)
      ctx.beginPath()
      ctx.arc(q.x, q.y, 5, 0, 7)
      ctx.fillStyle = '#a2693a'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = INK
      ctx.stroke()
    }
  }
  if (plot.fillZone.length >= 3) {
    line(plot.fillZone, true)
    ctx.fillStyle = 'rgba(127, 214, 214, 0.10)'
    ctx.fill()
    ctx.strokeStyle = '#7fd6d6'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── rows: mulch beds when close, a light dotted line from far away ──
  const bedPx = 1.4 / mpp
  for (const r of plot.rows) {
    const path = rowPath(r)
    line(path)
    const focus = st.focusRow === r.idx
    if (bedPx > 3) {
      ctx.lineCap = 'round'
      ctx.strokeStyle = focus ? 'rgba(255, 207, 74, 0.55)' : rowAB(r) === 'A' ? 'rgba(122, 82, 50, 0.42)' : 'rgba(94, 60, 34, 0.32)'
      ctx.lineWidth = bedPx
      ctx.stroke()
      ctx.lineCap = 'butt'
    } else {
      ctx.strokeStyle = focus ? '#ffcf4a' : 'rgba(255, 248, 232, 0.55)'
      ctx.lineWidth = focus ? 2.5 : 1.2
      ctx.setLineDash([3, 4])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // ── keylines: golden contour lines ──
  for (const ln of plot.lines) {
    if (ln.points.length < 2) continue
    line(ln.points)
    ctx.strokeStyle = hexA(INK, 0.6)
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = ln.isOffset ? '#9fd68a' : '#ffcf4a'
    ctx.lineWidth = 2.5
    ctx.setLineDash([10, 4, 2, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── plants, low strata first so the tall canopies sit on top ──
  const labels: { x: number; y: number; t: string; r: number }[] = []
  const emojis: { x: number; y: number; e: string; size: number }[] = []
  const pad = 80
  const showEmoji = (r: number) => r > 9
  // the support layer first (it sits under everything), then the crops, low strata first
  for (const [supPass, code] of [true, false].flatMap((x) => [...CODES].reverse().map((c) => [x, c] as const))) {
    const S = STRATA[code]
    for (const p of plot.plants) {
      const sp = st.lib.get(p.speciesId)
      if (!sp || sp.code !== code) continue
      const sup = p.role === 'support'
      if (sup !== supPass || (sup && !st.showSupport)) continue
      const q = P(p)
      if (q.x < -pad || q.x > W + pad || q.y < -pad || q.y > H + pad) continue
      // the support layer is pruned hard: drawn smaller, in a pale sage wash with a dotted edge, under the crops
      if (sup) {
        const rs = Math.max(2, (sp.widthM * 0.35) / mpp)
        ctx.beginPath()
        ctx.arc(q.x, q.y, rs, 0, 7)
        ctx.fillStyle = 'rgba(178, 214, 150, 0.42)'
        ctx.fill()
        ctx.setLineDash([2, 2])
        ctx.lineWidth = 1.2
        ctx.strokeStyle = S.color
        ctx.stroke()
        ctx.setLineDash([])
        if (st.inspect === p.id) {
          ctx.beginPath()
          ctx.arc(q.x, q.y, rs + 4, 0, 7)
          ctx.strokeStyle = '#ffcf4a'
          ctx.lineWidth = 3
          ctx.stroke()
        }
        if (rs > 7) emojis.push({ x: q.x, y: q.y, e: '🌿', size: Math.min(18, Math.max(9, rs * 0.7)) })
        continue
      }
      const r = Math.max(2.5, sp.widthM / 2 / mpp)
      // the canopy: a wash that's deeper at the centre, like watercolour pooling
      if (r > 6) {
        const g = ctx.createRadialGradient(q.x, q.y, r * 0.1, q.x, q.y, r)
        g.addColorStop(0, hexA(sp.leaf, 0.55))
        g.addColorStop(0.75, hexA(S.wash, 0.38))
        g.addColorStop(1, hexA(S.wash, 0.18))
        ctx.fillStyle = g
      } else ctx.fillStyle = hexA(S.wash, 0.45)
      ctx.beginPath()
      ctx.arc(q.x, q.y, r, 0, 7)
      ctx.fill()
      const lc = LIFECYCLE[sp.lifecycle]
      ctx.setLineDash(lc.dash)
      ctx.lineWidth = lc.width
      ctx.strokeStyle = S.color
      ctx.stroke()
      ctx.setLineDash([])
      if (st.fits.get(sp.id)?.level === 'no' && r > 4) {
        ctx.beginPath()
        ctx.arc(q.x, q.y, r + 3, 0, 7)
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.9)'
        ctx.lineWidth = 2
        ctx.setLineDash([2, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (st.inspect === p.id) {
        ctx.beginPath()
        ctx.arc(q.x, q.y, r + 5, 0, 7)
        ctx.strokeStyle = '#ffcf4a'
        ctx.lineWidth = 3
        ctx.stroke()
      }
      if (showEmoji(r)) emojis.push({ x: q.x, y: q.y, e: sp.emoji, size: Math.min(30, Math.max(11, r * 0.8)) })
      else {
        ctx.beginPath()
        ctx.arc(q.x, q.y, Math.max(1.5, r * 0.18), 0, 7)
        ctx.fillStyle = S.color
        ctx.fill()
      }
      if (st.labels && r > 11) labels.push({ x: q.x, y: q.y + r + 2, t: sp.name, r })
    }
  }
  // emoji after every canopy is down, never on top of each other, so each layer shows through
  if (emojis.length) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const cell = 26
    const used = new Set<string>()
    for (const j of emojis) {
      const k = `${Math.floor(j.x / cell)},${Math.floor(j.y / cell)}`
      if (used.has(k)) continue
      used.add(k)
      ctx.font = `${j.size}px serif`
      ctx.fillText(j.e, j.x, j.y + 1)
    }
  }
  // names last: biggest canopies win, and no two labels overlap
  if (labels.length) {
    ctx.font = '600 12px Alegreya, Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    labels.sort((a, b) => b.r - a.r)
    const taken: number[][] = []
    const lastOf = new Map<string, Pt[]>() // a name once per neighbourhood is enough
    for (const j of labels) {
      const w = ctx.measureText(j.t).width
      const box = [j.x - w / 2 - 2, j.y - 1, j.x + w / 2 + 2, j.y + 14]
      if (taken.some((b) => !(box[2]! < b[0]! || box[0]! > b[2]! || box[3]! < b[1]! || box[1]! > b[3]!))) continue
      const seenAt = lastOf.get(j.t) ?? []
      if (seenAt.some((p) => Math.hypot(p.x - j.x, p.y - j.y) < 220)) continue
      seenAt.push(j)
      lastOf.set(j.t, seenAt)
      taken.push(box)
      ctx.lineWidth = 3.5
      ctx.strokeStyle = hexA(INK, 0.85)
      ctx.lineJoin = 'round'
      ctx.strokeText(j.t, j.x, j.y)
      ctx.fillStyle = CREAM
      ctx.fillText(j.t, j.x, j.y)
    }
  }

  // ── what the tool will do ──
  if (st.ghost) {
    const q = P(st.ghost.at)
    const r = Math.max(4, st.ghost.sp.widthM / 2 / mpp)
    ctx.beginPath()
    ctx.arc(q.x, q.y, r, 0, 7)
    ctx.fillStyle = hexA(STRATA[st.ghost.sp.code].wash, 0.3)
    ctx.fill()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 2
    ctx.strokeStyle = CREAM
    ctx.stroke()
    ctx.setLineDash([])
    if (r > 9) {
      ctx.globalAlpha = 0.7
      ctx.font = `${Math.min(30, Math.max(11, r * 0.8))}px serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(st.ghost.sp.emoji, q.x, q.y + 1)
      ctx.globalAlpha = 1
    }
  }
  if (st.drawPts.length) {
    const col = st.tool === 'keyline' ? '#ffcf4a' : st.tool === 'zone' ? '#7fd6d6' : CREAM
    line(st.mouse ? [...st.drawPts, st.mouse] : st.drawPts)
    ctx.strokeStyle = hexA(INK, 0.7)
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = col
    ctx.lineWidth = 2.5
    ctx.setLineDash([7, 5])
    ctx.stroke()
    ctx.setLineDash([])
    st.drawPts.forEach((p, i) => {
      const q = P(p)
      ctx.beginPath()
      // the first corner is a bigger target: tap it to close the shape
      ctx.arc(q.x, q.y, i === 0 && st.tool !== 'keyline' && st.drawPts.length >= 3 ? 10 : 5, 0, 7)
      ctx.fillStyle = i === 0 ? '#ffcf4a' : col
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = INK
      ctx.stroke()
    })
  }
  if (st.orientPts.length === 1 && st.mouse) {
    const a = P(st.orientPts[0]!)
    const b = P(st.mouse)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = '#ffcf4a'
    ctx.lineWidth = 3
    ctx.setLineDash([6, 5])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── on the rows step, a compass rose for the row direction ──
  if (st.step === 'rows' && plot.boundary.length >= 3) {
    const c = llCentroid(plot.boundary)
    const F = frameAt(c)
    const th = (plot.rowDir * Math.PI) / 180
    const len = 40
    const a = P(F.toLL(Math.cos(th) * len * mpp, Math.sin(th) * len * mpp))
    const b = P(F.toLL(-Math.cos(th) * len * mpp, -Math.sin(th) * len * mpp))
    const cc = P(c)
    ctx.beginPath()
    ctx.arc(cc.x, cc.y, len + 10, 0, 7)
    ctx.fillStyle = 'rgba(255, 248, 232, 0.75)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = '#7a5232'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.lineCap = 'butt'
    for (const e of [a, b]) {
      ctx.beginPath()
      ctx.arc(e.x, e.y, 4, 0, 7)
      ctx.fillStyle = '#4fb852'
      ctx.fill()
    }
    ctx.fillStyle = INK
    ctx.font = '700 11px Alegreya, Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(((plot.rowDir % 180) + 180) % 180)}°`, cc.x, cc.y - 14)
  }
}

export type { Plant }
