import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { ClimateResult, GeoResult, Keyline, LibSpecies, LL, Plant, PlotData, Row } from '#shared/types'
import { computeEnv } from '~/utils/env'
import { GROUP_ORDER, type Group } from '~/utils/suggest'
import {
  buildKML, download, fileSafe, frameAt, keylineRows, llCentroid, longestEdgeAngle, nearestRow, parseKMLPolys, pathSampler, polyAreaM2, rowAB, rowPath, straightRows,
} from '~/utils/geo'
import { bestCards, clearance, fitFor, fromByron, libById, LIBRARY, toByron, yieldDefaults, type YieldCfg } from '~/utils/library'

// One shared store for the whole app (client-only, so module scope is safe).
//   intro  → the painted forest and a single question: where's your land?
//   map    → the satellite designer (Byron's v13 tools, three steps: land, rows, plant)
//   forest → close enough to stand in it: the same design grown in 3D
export type Stage = 'intro' | 'map' | 'forest'
export type Step = 'land' | 'rows' | 'plant'
export type Tool = 'pan' | 'boundary' | 'keyline' | 'zone' | 'orient' | 'place' | 'erase' | 'inspect' | 'fillrow'
export type Scope = 'all' | 'A' | 'B' | number
export interface RecipeStep { speciesId: string; spacing: number; rows?: 'all' | 'A' | 'B'; group?: Group }

export interface SavedDesign {
  id: string
  name: string
  savedAt: number
  geo: GeoResult
  climate: ClimateResult | null
  plot: PlotData
  rowMode: 'straight' | 'keyline'
  view: { lat: number; lng: number; zoom: number } | null
  yields: Record<string, Partial<YieldCfg>>
  uid: number
}
const SAVE_KEY = 'daff.designs.v1'
const MAX_SAVES = 24

const emptyPlot = (): PlotData => ({ boundary: [], fillZone: [], rowDir: 0, rowSpacing: 4, rows: [], plants: [], lines: [] })

const stage = ref<Stage>('intro')
const geo = shallowRef<GeoResult | null>(null)
const climate = shallowRef<ClimateResult | null>(null)
const climateLoading = ref(false)
const locating = ref(false)
const error = ref('')
const plot = reactive<PlotData>(emptyPlot())
const rowMode = ref<'straight' | 'keyline'>('straight')
const name = ref('')
const step = ref<Step>('land')
const tool = ref<Tool>('pan')
const selSpId = ref<string | null>(null)
const fillMode = ref<'target' | 'design'>('target')
const drawPts = ref<LL[]>([])
const orientPts = ref<LL[]>([])
const inspect = ref<string | null>(null) // plant id shown in the card (map)
const focusRow = ref<number | null>(null)
const year = ref(5)
const selected = ref<number | null>(null) // plant index in the 3D scene
const yields = reactive<Record<string, Partial<YieldCfg>>>({})
const dash = reactive({ horizon: 20, mode: 'yield' as 'yield' | 'value', density: 0.6 })
const ui = reactive({
  labels: true, sat: 0.9, harvest: false, menu: false, showAll: false, mobile: false, forceDay: false, birdseye: false, autoOrbit: false,
  recipe: false, satGround: true, kml: [] as { pts: LL[]; name: string; area: number }[], saves: false, card: null as string | null, panel: true, crown: 1.1,
})
const input = reactive({ forward: false, back: false, left: false, right: false, rotL: false, rotR: false, zoomIn: false, zoomOut: false })
const clock = ref(Date.now())
const toast = ref('')
const saves = ref<SavedDesign[]>([])
const currentId = ref<string | null>(null)
const mapView = ref<{ lat: number; lng: number; zoom: number } | null>(null)
const forestFocus = ref<{ x: number; z: number } | null>(null) // where the dive into 3D lands
const version = ref(0) // bumps on every design edit (cheap change signal for the canvas + autosave)
const lastBlocked = ref<{ sid: string; scope: Scope; n: number } | null>(null) // spots a fill skipped because other crowns were in the way
const fitRequest = ref(0) // the map frames the land when this bumps
let uid = 1
let toastTimer: ReturnType<typeof setTimeout> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
const hist: string[] = []
let histIdx = -1
const histState = reactive({ canUndo: false, canRedo: false })

function readSaves(): SavedDesign[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => x?.id && x?.geo && x?.plot) : []
  } catch {
    return []
  }
}
function writeSaves(list: SavedDesign[]) {
  saves.value = list
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list))
    return true
  } catch {
    return false // private mode / storage full: still works for this visit
  }
}
if (typeof window !== 'undefined') {
  setInterval(() => (clock.value = Date.now()), 60_000)
  saves.value = readSaves()
}

const nid = () => 'p' + uid++

export function useDesign() {
  const site = computed(() => climate.value?.site ?? null)
  const weather = computed(() => climate.value?.weather ?? null)
  const env = computed(() => (clock.value, computeEnv(site.value, weather.value, ui.forceDay)))
  const areaM2 = computed(() => (version.value, polyAreaM2(plot.boundary)))
  const imperial = computed(() => ['US', 'LR', 'MM'].includes((geo.value?.country || site.value?.country || 'US').toUpperCase()))
  const cards = computed(() => bestCards(site.value))
  const fits = computed(() => new Map(LIBRARY.map((sp) => [sp.id, fitFor(sp, site.value)])))
  const selSp = computed(() => (selSpId.value ? libById.get(selSpId.value) ?? null : null))
  const counts = computed(() => {
    version.value
    const m = new Map<string, number>()
    for (const p of plot.plants) m.set(p.speciesId, (m.get(p.speciesId) ?? 0) + 1)
    return m
  })
  const inUse = computed(() => [...counts.value.keys()].map((id) => libById.get(id)).filter((x): x is LibSpecies => !!x))
  const rowMetres = computed(() => (version.value, plot.rows.reduce((a, r) => a + pathSampler(rowPath(r)).total, 0)))
  // how much of the land each stratum's mature crowns cover (the Codex aims for E 20%, H 40%, M 60%, L 80%)
  const canopyShare = computed(() => {
    const out = { E: 0, H: 0, M: 0, L: 0 }
    const land = areaM2.value
    if (!land) return out
    for (const [id, n] of counts.value) {
      const sp = libById.get(id)
      if (sp) out[sp.code] += (n * Math.PI * (sp.widthM / 2) ** 2) / land
    }
    return out
  })

  function say(msg: string, ms = 3200) {
    toast.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), ms)
  }

  // ── history ──
  const snap = () => JSON.stringify({ plot, uid })
  function pushHist() {
    hist.splice(histIdx + 1)
    hist.push(snap())
    if (hist.length > 40) hist.shift()
    histIdx = hist.length - 1
    histState.canUndo = histIdx > 0
    histState.canRedo = false
  }
  function restore(s: string) {
    const d = JSON.parse(s)
    Object.assign(plot, d.plot)
    uid = d.uid
    changed(false)
  }
  function undo() {
    if (histIdx <= 0) return
    restore(hist[--histIdx]!)
    histState.canUndo = histIdx > 0
    histState.canRedo = true
  }
  function redo() {
    if (histIdx >= hist.length - 1) return
    restore(hist[++histIdx]!)
    histState.canUndo = true
    histState.canRedo = histIdx < hist.length - 1
  }
  function resetHist() {
    hist.length = 0
    histIdx = -1
    pushHist()
  }
  // every edit: record it, repaint, autosave
  function changed(record = true) {
    if (record) pushHist()
    version.value++
    scheduleSave()
  }

  // ── where ──
  async function locate(q: string) {
    error.value = ''
    locating.value = true
    try {
      const g = await $fetch<GeoResult>('/api/geocode', { query: { q } })
      startDesign(g)
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.statusMessage || 'Something went wrong finding that place.'
    } finally {
      locating.value = false
    }
  }
  function startDesign(g: GeoResult) {
    geo.value = g
    climate.value = null
    Object.assign(plot, emptyPlot())
    rowMode.value = 'straight'
    for (const k of Object.keys(yields)) delete yields[k]
    name.value = g.label
    currentId.value = null
    mapView.value = { lat: g.lat, lng: g.lon, zoom: 18 }
    step.value = 'land'
    tool.value = 'boundary'
    drawPts.value = []
    selSpId.value = null
    resetHist()
    stage.value = 'map'
    readClimate()
  }
  async function readClimate() {
    const g = geo.value
    if (!g) return
    climateLoading.value = true
    try {
      climate.value = await $fetch<ClimateResult>('/api/climate', { query: { lat: g.lat, lon: g.lon, label: g.label, country: g.country } })
      scheduleSave()
    } catch {
      say('Could not read the climate here. Species fit will be rough.')
    } finally {
      climateLoading.value = false
    }
  }

  // ── drawing (boundary, keyline, fill zone, row direction) ──
  function setTool(t: Tool) {
    if (t !== tool.value) drawPts.value = []
    if (t !== 'orient') orientPts.value = []
    tool.value = t
    inspect.value = null
  }
  function addPoint(ll: LL) {
    drawPts.value = [...drawPts.value, ll]
  }
  function finishDraw() {
    const pts = drawPts.value
    const t = tool.value
    drawPts.value = []
    if (t === 'boundary') {
      if (pts.length < 3) return say('A boundary needs at least three corners.')
      setBoundary(pts)
    } else if (t === 'keyline') {
      if (pts.length < 2) return
      plot.lines = [...plot.lines, { id: nid(), points: pts, isContour: true, isOffset: false }]
      tool.value = 'pan'
      changed()
      say('Keyline drawn. Now fill the land with rows that follow it.')
    } else if (t === 'zone') {
      if (pts.length < 3) return
      plot.fillZone = pts
      tool.value = 'pan'
      changed()
      say('Zone set: keyline rows will fill just this part.')
    }
  }
  function setBoundary(pts: LL[], label?: string) {
    plot.boundary = pts.slice()
    plot.rowDir = longestEdgeAngle(pts)
    plot.rows = []
    plot.fillZone = []
    if (rowMode.value === 'straight') plot.rows = straightRows(plot.boundary, plot.rowDir, plot.rowSpacing)
    retag()
    tool.value = 'pan'
    changed()
    fitRequest.value++
    const a = polyAreaM2(pts)
    say(`${label ? `“${label}” · ` : ''}${fmtAreaShort(a)} staked out. Rows run along your longest edge.`)
    step.value = 'rows'
  }
  function clearBoundary() {
    Object.assign(plot, { boundary: [], fillZone: [], rows: [] })
    tool.value = 'boundary'
    step.value = 'land'
    changed()
  }

  // ── rows ──
  function relayRows(record = true) {
    if (rowMode.value !== 'straight' || plot.boundary.length < 3) return
    plot.rows = straightRows(plot.boundary, plot.rowDir, plot.rowSpacing)
    retag()
    changed(record)
  }
  let lightHist = 0
  function setRowDir(deg: number) {
    plot.rowDir = ((deg % 360) + 360) % 360
    const now = Date.now()
    relayRows(now - lightHist > 500)
    lightHist = now
  }
  function setRowSpacing(m: number) {
    plot.rowSpacing = Math.max(0.5, Math.min(30, m))
    const now = Date.now()
    if (rowMode.value === 'straight') relayRows(now - lightHist > 500)
    else changed(now - lightHist > 500)
    lightHist = now
  }
  function setRowMode(m: 'straight' | 'keyline') {
    rowMode.value = m
    if (m === 'straight') relayRows()
    else {
      if (!plot.lines.some((l) => !l.isOffset)) setTool('keyline')
      changed(false)
    }
  }
  function orientFrom(a: LL, b: LL) {
    const m = frameAt(a).toM(b.lat, b.lng)
    setRowDir((Math.atan2(m.y, m.x) * 180) / Math.PI)
    tool.value = 'pan'
  }
  function fillFromKeyline(opts: { append?: boolean; includeBase?: boolean; lineId?: string } = {}) {
    if (plot.boundary.length < 3) return say('Stake out your land first: keyline rows are clipped to it.')
    const base = plot.lines.find((l) => l.id === opts.lineId) ?? plot.lines.find((l) => l.isContour && !l.isOffset)
    if (!base) return say('Draw a keyline first: trace along the contour of your slope.')
    const { rows, tooFine } = keylineRows(plot.boundary, base.points, plot.rowSpacing, { zone: plot.fillZone, includeBase: opts.includeBase !== false, existing: opts.append ? plot.rows : [] })
    if (tooFine) return say('That spacing is too fine for this much land. Widen it.')
    if (!rows.length) return say(plot.fillZone.length >= 3 ? 'No rows in that zone. Is the keyline near it?' : 'No rows made. Is the keyline on your land?')
    if (opts.append) {
      let idx = plot.rows.length ? Math.max(...plot.rows.map((r) => r.idx)) + 1 : 0
      plot.rows = [...plot.rows, ...rows.map((g) => ({ idx: idx++, lvl: g.k, path: g.path, a: g.path[0]!, b: g.path[g.path.length - 1]! }))]
    } else {
      plot.rows = rows.map((g, i) => ({ idx: i, lvl: g.k, path: g.path, a: g.path[0]!, b: g.path[g.path.length - 1]! }))
    }
    retag()
    changed()
    say(`${rows.length} rows follow your keyline at ${plot.rowSpacing} m.`)
  }
  function clearKeylines() {
    plot.lines = []
    plot.fillZone = []
    changed()
  }
  function offsetKeyline(id: string, dist: number) {
    const src = plot.lines.find((l) => l.id === id)
    if (!src) return
    const F = frameAt(llCentroid(src.points))
    const m = src.points.map((p) => F.toM(p.lat, p.lng))
    const norm = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = Math.hypot(dx, dy)
      return l < 0.001 ? { x: 0, y: 1 } : { x: dy / l, y: -dx / l }
    }
    const pts = m.map((pt, i) => {
      const prev = m[i - 1]
      const next = m[i + 1]
      let n = prev && next ? { x: norm(prev, pt).x + norm(pt, next).x, y: norm(prev, pt).y + norm(pt, next).y } : prev ? norm(prev, pt) : norm(pt, next!)
      const l = Math.hypot(n.x, n.y) || 1
      n = { x: n.x / l, y: n.y / l }
      return F.toLL(pt.x + n.x * dist, pt.y + n.y * dist)
    })
    plot.lines = [...plot.lines, { id: nid(), points: pts, isContour: true, isOffset: true }]
    changed()
  }
  // re-attach plants to the nearest row after rows change
  function retag() {
    const reach = plot.rowSpacing
    for (const p of plot.plants) p.rowIdx = nearestRow(plot.rows, p, reach)?.row ?? -1
  }

  // ── plants ──
  const spacingOf = (sp: LibSpecies) => {
    const r = fillMode.value === 'design' ? sp.designRS : sp.targetRS
    return Math.max(0.1, (r[0] + r[1]) / 2)
  }
  function placeAt(ll: LL) {
    const sp = selSp.value
    if (!sp) return say('Pick a plant first.')
    const sn = nearestRow(plot.rows, ll, plot.rowSpacing / 2)
    plot.plants.push({ id: nid(), speciesId: sp.id, lat: sn?.ll.lat ?? ll.lat, lng: sn?.ll.lng ?? ll.lng, rowIdx: sn?.row ?? -1 })
    changed()
  }
  function plantNear(ll: LL, tolM: number): Plant | null {
    const F = frameAt(ll)
    let best: Plant | null = null
    let bd = Infinity
    for (const p of plot.plants) {
      const sp = libById.get(p.speciesId)
      if (!sp) continue
      const m = F.toM(p.lat, p.lng)
      const d = Math.hypot(m.x, m.y)
      if (d < Math.max(sp.widthM / 2, tolM) && d < bd) { bd = d; best = p }
    }
    return best
  }
  function eraseAt(ll: LL, tolM: number) {
    const p = plantNear(ll, tolM)
    if (p) {
      plot.plants = plot.plants.filter((x) => x.id !== p.id)
      changed()
      return
    }
    // no plant under the finger: erase a keyline instead
    const F = frameAt(ll)
    const line = plot.lines.find((l) => l.points.some((q, i) => {
      const b = l.points[i + 1]
      if (!b) return false
      const A = F.toM(q.lat, q.lng)
      const B = F.toM(b.lat, b.lng)
      const dx = B.x - A.x
      const dy = B.y - A.y
      const L2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / L2))
      return Math.hypot(A.x + t * dx, A.y + t * dy) < tolM
    }))
    if (line) {
      plot.lines = plot.lines.filter((l) => l.id !== line.id)
      changed()
      say('Keyline erased.')
    }
  }
  function inspectAt(ll: LL, tolM: number) {
    inspect.value = plantNear(ll, tolM)?.id ?? null
  }
  function rowTargets(scope: Scope) {
    if (scope === 'all') return plot.rows
    if (scope === 'A' || scope === 'B') return plot.rows.filter((r) => rowAB(r) === scope)
    return plot.rows.filter((r) => r.idx === scope)
  }
  // A spatial guard so planted species keep out of each other's crowns (see clearance in library.ts).
  function makeGuard() {
    const anchor = plot.boundary.length ? llCentroid(plot.boundary) : plot.rows[0]?.a ?? { lat: 0, lng: 0 }
    const F = frameAt(anchor)
    const CELL = 10
    const grid = new Map<string, { x: number; y: number; sp: LibSpecies }[]>()
    const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
    const add = (ll: LL, sp: LibSpecies) => {
      const m = F.toM(ll.lat, ll.lng)
      const k = key(m.x, m.y)
      const c = grid.get(k)
      if (c) c.push({ ...m, sp })
      else grid.set(k, [{ ...m, sp }])
    }
    const free = (ll: LL, sp: LibSpecies) => {
      const m = F.toM(ll.lat, ll.lng)
      const cx = Math.floor(m.x / CELL)
      const cy = Math.floor(m.y / CELL)
      for (let gx = cx - 2; gx <= cx + 2; gx++) {
        for (let gy = cy - 2; gy <= cy + 2; gy++) {
          for (const o of grid.get(`${gx},${gy}`) ?? []) if (Math.hypot(o.x - m.x, o.y - m.y) < clearance(sp, o.sp)) return false
        }
      }
      return true
    }
    for (const p of plot.plants) {
      const sp = libById.get(p.speciesId)
      if (sp) add(p, sp)
    }
    return { add, free }
  }

  // Fill rows with one species at its Codex spacing (Target RS, or the 50% Design RS for overplanting).
  // Refreshes only that species on those rows; every other stratum already there stays.
  function fillRows(sid: string, scope: Scope, phase = 0.5, record = true, spacing?: number, force = false) {
    const sp = libById.get(sid)
    if (!sp) return 0
    if (!plot.rows.length) {
      say('Lay out rows first.')
      return 0
    }
    const targets = rowTargets(scope)
    const ids = new Set(targets.map((r) => r.idx))
    plot.plants = plot.plants.filter((p) => !(p.speciesId === sid && ids.has(p.rowIdx)))
    const gap = Math.max(0.1, spacing ?? spacingOf(sp))
    const guard = makeGuard()
    let n = 0
    let blocked = 0
    for (const r of targets) {
      const smp = pathSampler(rowPath(r))
      // start half a spacing in, so no canopy hangs over the boundary
      for (let d = gap * phase; d <= smp.total - gap * 0.25 + 1e-6; d += gap) {
        // if another species' crown is in the way, slide a little along the row before giving up on this spot
        const at = force ? d : [0, 0.25, -0.25, 0.5, -0.5].map((f) => d + f * gap).find((x) => x >= 0 && x <= smp.total && guard.free(smp.at(x), sp))
        if (at === undefined) {
          blocked++
          continue
        }
        const ll = smp.at(at)
        guard.add(ll, sp)
        plot.plants.push({ id: nid(), speciesId: sid, lat: ll.lat, lng: ll.lng, rowIdx: r.idx })
        n++
      }
    }
    if (record) changed()
    lastBlocked.value = blocked && !force ? { sid, scope, n: blocked } : null
    return n
  }
  // A row recipe, two ways:
  //  layers   → each species fills the row at its own spacing (a syntropic consortium, stacked by strata)
  //  sequence → Byron's pattern: place A, step its gap, place B, step… and repeat
  function applyRecipe(steps: RecipeStep[], scope: Scope, mode: 'layers' | 'sequence' | 'mix') {
    if (!steps.length) return
    if (!plot.rows.length) return say('Lay out rows first.')
    if (mode === 'mix') {
      // Mixed layers, as in a syntropic consortium: the species of one layer take turns along the row, each layer at
      // its own average spacing, tall layers first. Where a crown is in the way a plant slides along the row or is skipped.
      const inScope = new Set(rowTargets(scope).map((r) => r.idx))
      const groups = new Map<Group, RecipeStep[]>()
      for (const st of steps) {
        const sp = libById.get(st.speciesId)
        if (!sp) continue
        const g = st.group ?? (sp.code as Group)
        groups.set(g, [...(groups.get(g) ?? []), st])
      }
      const sids = new Set(steps.map((x) => x.speciesId))
      plot.plants = plot.plants.filter((p) => !(inScope.has(p.rowIdx) && sids.has(p.speciesId)))
      const guard = makeGuard()
      let n = 0
      let skipped = 0
      GROUP_ORDER.filter((g) => groups.has(g)).forEach((g, gi) => {
        const members = groups.get(g)!
        const pool = members.map((m) => libById.get(m.speciesId)!)
        const gap = Math.max(0.3, members.reduce((a, m) => a + (m.spacing || 1), 0) / members.length)
        const only = members[0]!.rows && members[0]!.rows !== 'all' ? members[0]!.rows : null
        const rows = rowTargets(only ?? 'all').filter((r) => inScope.has(r.idx))
        // herbs and ground cover are planted across the bed, alternating either side of the row line
        const across = g === 'B' ? 0.45 : g === 'G' ? 0.85 : 0
        for (const r of rows) {
          const smp = pathSampler(rowPath(r))
          let k = r.idx // rotate where each row starts so neighbouring rows don't mirror each other
          for (let d = gap * (0.5 + gi * 0.13); d <= smp.total - gap * 0.25 + 1e-6; d += gap, k++) {
            // try the species whose turn it is first, then the others; for each, the spot and then a little either side
            let placed = false
            for (let t = 0; t < pool.length && !placed; t++) {
              const sp = pool[(k + t) % pool.length]!
              for (const f of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) {
                const x = d + f * gap
                if (x < 0 || x > smp.total) continue
                const ll = across ? offsetAcross(smp, x, (k % 2 ? 1 : -1) * across) : smp.at(x)
                if (!guard.free(ll, sp)) continue
                guard.add(ll, sp)
                plot.plants.push({ id: nid(), speciesId: sp.id, lat: ll.lat, lng: ll.lng, rowIdx: r.idx })
                n++
                placed = true
                break
              }
            }
            if (!placed) skipped++
          }
        }
      })
      changed()
      return say(`🌱 ${n.toLocaleString()} plants in ${groups.size} mixed layers${skipped ? `; ${skipped.toLocaleString()} spots skipped to keep crowns apart` : ''}.`, 5000)
    }
    if (mode === 'layers') {
      let n = 0
      // a layer can keep to the A or B rows (say, emergents on A, high trees on B), within the chosen rows
      steps.forEach((st, i) => {
        const only = st.rows && st.rows !== 'all' ? st.rows : null
        const sc: Scope = only && (scope === 'all' || scope === only) ? only : scope
        if (only && sc !== only) return
        n += fillRows(st.speciesId, sc, i % 2 ? 0.25 : 0.5, false, st.spacing)
      })
      changed()
      return say(`🌱 ${n.toLocaleString()} plants, ${steps.length} layers deep.`)
    }
    const targets = rowTargets(scope)
    const ids = new Set(targets.map((r) => r.idx))
    const sids = new Set(steps.map((s) => s.speciesId))
    plot.plants = plot.plants.filter((p) => !(ids.has(p.rowIdx) && sids.has(p.speciesId)))
    let n = 0
    const clear = makeGuard()
    for (const r of targets) {
      const smp = pathSampler(rowPath(r))
      let t = Math.max(0.5, (steps[0]!.spacing || 1) / 2)
      let si = 0
      let guard = 0
      while (t <= smp.total + 1e-6 && guard++ < 40000) {
        const st = steps[si % steps.length]!
        const ll = smp.at(t)
        const sp = libById.get(st.speciesId)
        if (sp && clear.free(ll, sp)) {
          clear.add(ll, sp)
          plot.plants.push({ id: nid(), speciesId: st.speciesId, lat: ll.lat, lng: ll.lng, rowIdx: r.idx })
          n++
        }
        t += st.spacing || 1
        si++
      }
    }
    changed()
    say(`🌱 ${n.toLocaleString()} plants in sequence.`)
  }
  function clearRow(ri: number) {
    plot.plants = plot.plants.filter((p) => p.rowIdx !== ri)
    changed()
  }
  function clearSpecies(sid: string) {
    plot.plants = plot.plants.filter((p) => p.speciesId !== sid)
    changed()
  }
  function clearPlants() {
    plot.plants = []
    changed()
  }

  // ── KML / JSON ──
  async function importKMLFile(f: File) {
    try {
      const polys = parseKMLPolys(await f.text())
      if (!polys.length) return say('No polygon in that KML. Export your boundary as a polygon, or trace it on the map.')
      if (polys.length === 1) setBoundary(polys[0]!.pts, polys[0]!.name)
      else ui.kml = polys
    } catch (e: any) {
      say(`Could not read that KML: ${e?.message ?? e}`)
    }
  }
  function exportKML() {
    if (!plot.plants.length && !plot.boundary.length) return say('Nothing to export yet.')
    const plants = plot.plants.flatMap((p) => {
      const sp = libById.get(p.speciesId)
      return sp ? [{ ...p, sp }] : []
    })
    download(buildKML(name.value || 'Food forest', plot.boundary, plot.rows, plot.lines, plants), fileSafe(name.value) + '.kml', 'application/vnd.google-earth.kml+xml')
  }
  // Byron's v3 project format, so files move between his designer and this one
  function exportJSON() {
    const plants = plot.plants.map((p) => ({ ...p, speciesId: toByron.get(p.speciesId) ?? p.speciesId }))
    const out = {
      v: 3, plots: [{ id: 'plot1', name: name.value, visible: true, ...plot, plants }], activePlotId: 'plot1', uid,
      designafoodforest: { geo: geo.value, site: site.value, rowMode: rowMode.value, yields },
    }
    download(JSON.stringify(out, null, 2), fileSafe(name.value) + '.json', 'application/json')
  }
  async function importJSONFile(f: File) {
    try {
      const d = JSON.parse(await f.text())
      const p = d.plots?.find((x: any) => x.id === d.activePlotId) ?? d.plots?.[0] ?? d.plot ?? d
      if (!p?.boundary && !p?.plants) return say('That file isn\'t a design we recognise.')
      // Byron's species ids are sp_<name>_<strata>; ours are <name>-<strata>
      const conv = (id: string) => (libById.has(id) ? id : fromByron.get(id) ?? id.replace(/^sp_/, '').replace(/_/g, '-'))
      const plants: Plant[] = (p.plants ?? []).map((x: Plant) => ({ ...x, speciesId: conv(x.speciesId) }))
      const lost = plants.filter((x) => !libById.has(x.speciesId)).length
      const ex = d.designafoodforest
      const at = p.boundary?.length ? llCentroid(p.boundary) : plants[0] ?? null
      const g: GeoResult = ex?.geo ?? (at ? { label: p.name || 'Imported design', full: p.name || '', lat: at.lat, lon: at.lng, country: '' } : null)
      if (!g) return say('That design has no location.')
      startDesign(g)
      name.value = p.name || g.label
      Object.assign(plot, { boundary: p.boundary ?? [], fillZone: p.fillZone ?? [], rowDir: p.rowDir ?? 0, rowSpacing: p.rowSpacing ?? 4, rows: p.rows ?? [], plants: plants.filter((x) => libById.has(x.speciesId)), lines: p.lines ?? [] })
      rowMode.value = ex?.rowMode ?? (plot.rows.some((r) => r.path) ? 'keyline' : 'straight')
      if (ex?.yields) Object.assign(yields, ex.yields)
      uid = Math.max(uid, d.uid ?? 1, plot.plants.length + 1)
      tool.value = 'pan'
      step.value = plot.plants.length ? 'plant' : plot.rows.length ? 'rows' : plot.boundary.length ? 'rows' : 'land'
      resetHist()
      changed(false)
      const custom = d.customSp?.length ? `, custom species aren't carried over` : ''
      say(`Opened “${name.value}”${lost ? ` (${lost} plants of unknown species skipped${custom})` : ''}.`, 5000)
    } catch (e: any) {
      say(`Could not open that file: ${e?.message ?? e}`)
    }
  }

  // ── saved designs (this device) ──
  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 700)
  }
  function saveNow() {
    if (!geo.value) return
    const entry: SavedDesign = {
      id: currentId.value ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.value || geo.value.label, savedAt: Date.now(), geo: geo.value, climate: climate.value,
      plot: JSON.parse(JSON.stringify(plot)), rowMode: rowMode.value, view: mapView.value, yields: JSON.parse(JSON.stringify(yields)), uid,
    }
    // nothing worth keeping until there's a boundary or a plant
    if (!entry.plot.boundary.length && !entry.plot.plants.length) return
    currentId.value = entry.id
    if (!writeSaves([entry, ...saves.value.filter((x) => x.id !== entry.id)].slice(0, MAX_SAVES))) say('Your browser storage is full: export a JSON to keep this design.')
  }
  function openSave(id: string) {
    const sv = saves.value.find((x) => x.id === id)
    if (!sv) return
    startDesign(sv.geo)
    currentId.value = sv.id
    name.value = sv.name
    if (sv.climate) climate.value = sv.climate
    Object.assign(plot, emptyPlot(), sv.plot)
    rowMode.value = sv.rowMode
    Object.assign(yields, sv.yields ?? {})
    uid = sv.uid ?? plot.plants.length + 1
    mapView.value = sv.view
    tool.value = 'pan'
    step.value = plot.plants.length ? 'plant' : plot.boundary.length ? 'rows' : 'land'
    resetHist()
    version.value++
    ui.saves = false
  }
  function deleteSave(id: string) {
    if (currentId.value === id) currentId.value = null
    writeSaves(saves.value.filter((x) => x.id !== id))
  }

  // ── 3D: the design in scene metres (x = east, z = south), centred on the land ──
  const scene = computed(() => {
    version.value
    const pts = plot.boundary.length >= 3 ? plot.boundary : plot.plants.length ? plot.plants : null
    const anchor = pts ? llCentroid(pts) : mapView.value ? { lat: mapView.value.lat, lng: mapView.value.lng } : geo.value ? { lat: geo.value.lat, lng: geo.value.lon } : { lat: 0, lng: 0 }
    const F0 = frameAt(anchor)
    // centre on the bounding box so the land spans ±width/2, ±depth/2
    let minX = -20, maxX = 20, minY = -20, maxY = 20
    if (pts) {
      const m = pts.map((p) => F0.toM(p.lat, p.lng))
      minX = Math.min(...m.map((p) => p.x)); maxX = Math.max(...m.map((p) => p.x))
      minY = Math.min(...m.map((p) => p.y)); maxY = Math.max(...m.map((p) => p.y))
    }
    const origin = F0.toLL((minX + maxX) / 2, (minY + maxY) / 2)
    const F = frameAt(origin)
    const xz = (p: LL): [number, number] => {
      const m = F.toM(p.lat, p.lng)
      return [m.x, -m.y]
    }
    const index = new Map<string, number>()
    const species: LibSpecies[] = []
    const plants: { s: number; x: number; z: number; id: string; rank: number }[] = []
    // Thinning is managed, not random: along each row a species is thinned to every other plant, then every
    // fourth…, and neighbouring rows are staggered (van der Corput order of the plant's place in its row).
    const seq = new Map<string, number>()
    const vdc = (n: number) => {
      let r = 0
      let f = 0.5
      for (; n; n >>= 1, f /= 2) if (n & 1) r += f
      return r
    }
    for (const p of plot.plants) {
      const sp = libById.get(p.speciesId)
      if (!sp) continue
      let s = index.get(sp.id)
      if (s === undefined) {
        s = species.length
        index.set(sp.id, s)
        species.push(sp)
      }
      const [x, z] = xz(p)
      const sk = `${p.speciesId}|${p.rowIdx}`
      const k = seq.get(sk) ?? 0
      seq.set(sk, k + 1)
      plants.push({ s, x, z, id: p.id, rank: vdc(k + Math.max(0, p.rowIdx)) })
    }
    return {
      origin,
      toLL: (x: number, z: number) => F.toLL(x, -z),
      toXZ: xz,
      width: Math.max(8, maxX - minX),
      depth: Math.max(8, maxY - minY),
      poly: plot.boundary.map(xz),
      rows: plot.rows.map((r) => rowPath(r).map(xz)),
      lines: plot.lines.map((l) => l.points.map(xz)),
      species,
      plants,
    }
  })
  function enterForest(at?: LL) {
    if (at) {
      const [x, z] = scene.value.toXZ(at)
      forestFocus.value = { x, z }
    } else forestFocus.value = null
    selected.value = null
    inspect.value = null
    ui.birdseye = false
    stage.value = 'forest'
  }
  function exitForest(at?: { x: number; z: number }) {
    if (at) {
      const ll = scene.value.toLL(at.x, at.z)
      mapView.value = { lat: ll.lat, lng: ll.lng, zoom: 19 }
    }
    selected.value = null
    stage.value = 'map'
  }

  return {
    stage, geo, climate, climateLoading, locating, error, site, weather, env, plot, rowMode, name, step, tool, selSpId, selSp, fillMode, drawPts, orientPts,
    inspect, focusRow, year, selected, yields, dash, ui, input, toast, saves, currentId, mapView, forestFocus, version, fitRequest, lastBlocked, histState, areaM2, imperial,
    cards, fits, counts, inUse, rowMetres, canopyShare, scene,
    say, undo, redo, changed, locate, startDesign, readClimate, setTool, addPoint, finishDraw, setBoundary, clearBoundary, setRowDir, setRowSpacing, setRowMode,
    orientFrom, fillFromKeyline, clearKeylines, offsetKeyline, placeAt, eraseAt, inspectAt, plantNear, fillRows, applyRecipe, clearRow, clearSpecies, clearPlants,
    spacingOf, importKMLFile, exportKML, exportJSON, importJSONFile, saveNow, openSave, deleteSave, enterForest, exitForest,
  }
}

// a point `side` metres to the left (+) or right (−) of a row's line at distance d along it
function offsetAcross(smp: ReturnType<typeof pathSampler>, d: number, side: number): LL {
  const p = smp.at(d)
  const F = frameAt(p)
  const A = F.toM(smp.at(Math.max(0, d - 0.4)).lat, smp.at(Math.max(0, d - 0.4)).lng)
  const B = F.toM(smp.at(d + 0.4).lat, smp.at(d + 0.4).lng)
  const dx = B.x - A.x
  const dy = B.y - A.y
  const l = Math.hypot(dx, dy) || 1
  return F.toLL((-dy / l) * side, (dx / l) * side)
}

export function fmtAreaShort(m2: number, imperial = true) {
  if (imperial) {
    const ac = m2 / 4046.86
    return ac >= 1 ? `${ac >= 10 ? Math.round(ac) : ac.toFixed(1)} acres` : `${Math.round(m2 * 10.764).toLocaleString()} sq ft`
  }
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(m2 >= 100000 ? 0 : 1)} ha` : `${Math.round(m2).toLocaleString()} m²`
}

export type { Keyline, Row }
