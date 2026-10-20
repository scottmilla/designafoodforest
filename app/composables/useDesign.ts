import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { ClimateResult, GeoAnswer, GeoResult, Keyline, LibSpecies, LL, Plant, PlotData, Precision, Row } from '#shared/types'
import { computeEnv } from '~/utils/env'
import { fmtDist } from '~/utils/fmt'
import { GROUP_ORDER, type Group } from '~/utils/suggest'
import {
  buildKML, download, fileSafe, frameAt, keylineRows, llCentroid, longestEdgeAngle, nearestRow, parseKMLPolys, pathSampler, pointInPoly, polyAreaM2, rowAB, rowPath, straightRows,
} from '~/utils/geo'
import { bestCards, canopy, clearance, fitFor, fromByron, libById, LIBRARY, libraryReady, libState, libVersion, setCanopy, setCanopyOverrides, toByron, yieldDefaults, type YieldCfg } from '~/utils/library'
import { defaultPicks, supportGap, type SupportCfg } from '~/utils/support'

// One shared store for the whole app (client-only, so module scope is safe).
//   intro  → the painted forest and a single question: where's your land?
//   map    → the satellite designer (Byron's v13 tools, three steps: land, rows, plant)
//   forest → close enough to stand in it: the same design grown in 3D
export type Stage = 'intro' | 'map' | 'forest'
export type Step = 'land' | 'rows' | 'plant'
export type Tool = 'pan' | 'boundary' | 'keyline' | 'zone' | 'orient' | 'place' | 'erase' | 'inspect' | 'fillrow'
export type Scope = 'all' | 'A' | 'B' | number
export interface RecipeStep { speciesId: string; spacing: number; rows?: 'all' | 'A' | 'B'; group?: Group }

// One piece of land in a design. A design can hold several (a home orchard and a far paddock, say), as in Byron's
// v13 designer. The active plot's data lives in `plot` below, so every tool works on it unchanged; `plots` keeps
// all of them (the active one's `data` is refreshed by commitActive before it's read).
export interface PlotEntry { id: string; name: string; visible: boolean; rowMode?: 'straight' | 'keyline'; data: PlotData }

export interface SavedDesign {
  id: string
  name: string
  savedAt: number
  geo: GeoResult
  climate: ClimateResult | null
  plot: PlotData // the active plot (older saves have only this)
  plots?: PlotEntry[]
  activePlotId?: string
  rowMode: 'straight' | 'keyline'
  view: { lat: number; lng: number; zoom: number } | null
  yields: Record<string, Partial<YieldCfg>>
  canopy?: Record<string, number> // per-design canopy widths, m (Byron's canopyOverrides)
  uid: number
}
const SAVE_KEY = 'daff.designs.v1'
const UNITS_KEY = 'daff.units'
type Units = 'auto' | 'metric' | 'imperial'
function readUnits(): Units {
  try {
    const u = typeof localStorage !== 'undefined' ? localStorage.getItem(UNITS_KEY) : null
    return u === 'metric' || u === 'imperial' ? u : 'auto'
  } catch {
    return 'auto'
  }
}
const MAX_SAVES = 24

const emptyPlot = (): PlotData => ({ boundary: [], fillZone: [], rowDir: 0, rowSpacing: 4, rows: [], plants: [], lines: [] })

const stage = ref<Stage>('intro')
const geo = shallowRef<GeoResult | null>(null)
const climate = shallowRef<ClimateResult | null>(null)
const climateLoading = ref(false)
const locating = ref(false)
const alternatives = shallowRef<GeoResult[]>([]) // other places the address could have meant
// the map zoom that shows an answer of each precision sensibly
const PRECISION_ZOOM: Record<Precision, number> = { house: 18, place: 18, street: 17, town: 14, region: 10 }
// the person's own country, from their browser's language ("en-NZ" → NZ), to rank local addresses first
export const browserCountry = () => {
  try {
    const r = new Intl.Locale(navigator.language).maximize().region
    return r && /^[A-Z]{2}$/.test(r) ? r : ''
  } catch {
    return ''
  }
}
const error = ref('')
const plot = reactive<PlotData>(emptyPlot())
const plots = shallowRef<PlotEntry[]>([])
const activePlotId = ref('')
const clonePlot = (p: PlotData): PlotData => JSON.parse(JSON.stringify(p))
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
  labels: true, sat: 0.9, harvest: false, menu: false, showAll: false, mobile: false, forceDay: false, birdseye: false, lockOn: true, tractor: false, autoOrbit: false,
  units: readUnits(), month: null as number | null, // m / ft override ('auto' follows the site's country); month override for the 3D seasons
  recipe: false, support: false, showSupport: true, satGround: true, kml: [] as { pts: LL[]; name: string; area: number }[], saves: false, card: null as string | null, panel: true, crown: 1.1,
})
const supportCfg = reactive<SupportCfg>({ picks: { E: null, H: null, M: null, L: null }, density: 'standard', between: false })
let supportPicksFor = '' // the site the picks were made for
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
const flyRequest = ref(0) // the map flies to mapView when this bumps
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
const pid = () => `plot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function useDesign() {
  const site = computed(() => climate.value?.site ?? null)
  const weather = computed(() => climate.value?.weather ?? null)
  const env = computed(() => (clock.value, computeEnv(site.value, weather.value, ui.forceDay, ui.month)))
  const areaM2 = computed(() => (version.value, polyAreaM2(plot.boundary)))
  const autoImperial = computed(() => ['US', 'LR', 'MM'].includes((geo.value?.country || site.value?.country || 'US').toUpperCase()))
  const imperial = computed(() => (ui.units === 'auto' ? autoImperial.value : ui.units === 'imperial'))
  function setUnits(u: 'metric' | 'imperial') {
    ui.units = u === (autoImperial.value ? 'imperial' : 'metric') ? 'auto' : u
    try {
      localStorage.setItem(UNITS_KEY, ui.units)
    } catch {}
  }
  const cards = computed(() => (libVersion.value, bestCards(site.value)))
  const fits = computed(() => (libVersion.value, new Map(LIBRARY.map((sp) => [sp.id, fitFor(sp, site.value)]))))
  const selSp = computed(() => (selSpId.value ? libById.get(selSpId.value) ?? null : null))
  const counts = computed(() => {
    version.value
    libVersion.value
    const m = new Map<string, number>()
    for (const p of plot.plants) m.set(p.speciesId, (m.get(p.speciesId) ?? 0) + 1)
    return m
  })
  const inUse = computed(() => [...counts.value.keys()].map((id) => libById.get(id)).filter((x): x is LibSpecies => !!x))
  const rowMetres = computed(() => (version.value, plot.rows.reduce((a, r) => a + pathSampler(rowPath(r)).total, 0)))
  // how much of the land each stratum's mature crowns cover (the Codex aims for E 20%, H 40%, M 60%, L 80%)
  const supportCount = computed(() => (version.value, plot.plants.reduce((a, p) => a + (p.role === 'support' ? 1 : 0), 0)))
  // how much of the land each stratum's mature crowns cover. Support plants are left out: they're pruned hard
  const canopyShare = computed(() => {
    version.value
    const out = { E: 0, H: 0, M: 0, L: 0 }
    const land = areaM2.value
    if (!land) return out
    for (const p of plot.plants) {
      if (p.role === 'support') continue
      const sp = libById.get(p.speciesId)
      if (sp) out[sp.code] += (Math.PI * (sp.widthM / 2) ** 2) / land
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
  // key: a pick from the type-ahead (exact, so no second guessing)
  async function locate(q: string, key?: string) {
    error.value = ''
    locating.value = true
    try {
      const { alternatives: alts, ...g } = await $fetch<GeoAnswer>('/api/geocode', { query: { q, ...(key ? { key } : {}), cc: browserCountry() } })
      if (stage.value === 'map') relocate(g)
      else startDesign(g)
      alternatives.value = key ? [] : alts ?? []
      if (g.precision && g.precision !== 'house' && g.precision !== 'place') {
        say(`We found ${g.precision === 'street' ? 'the street' : g.precision === 'town' ? 'the town' : 'the area'}, not the exact address. Pan to your land, then trace it.`, 6500)
      }
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
    setCanopyOverrides({})
    const first: PlotEntry = { id: pid(), name: 'Plot 1', visible: true, data: emptyPlot() }
    plots.value = [first]
    activePlotId.value = first.id
    rowMode.value = 'straight'
    for (const k of Object.keys(yields)) delete yields[k]
    name.value = g.label
    currentId.value = null
    mapView.value = { lat: g.lat, lng: g.lon, zoom: PRECISION_ZOOM[g.precision ?? 'house'] }
    alternatives.value = []
    step.value = 'land'
    tool.value = 'boundary'
    drawPts.value = []
    selSpId.value = null
    resetHist()
    stage.value = 'map'
    readClimate()
  }
  // a different address while on the map: an untouched design moves there; one with land drawn just flies the view
  function relocate(g: GeoResult) {
    if (plot.boundary.length || plot.plants.length) {
      mapView.value = { lat: g.lat, lng: g.lon, zoom: PRECISION_ZOOM[g.precision ?? 'house'] }
      flyRequest.value++
      return
    }
    startDesign(g)
    flyRequest.value++
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

  // ── plots: several pieces of land in one design (Byron's multi-plot model) ──
  // write the live plot back into the list (before saving, exporting or switching)
  function commitActive() {
    const i = plots.value.findIndex((p) => p.id === activePlotId.value)
    if (i < 0) return
    const list = plots.value.slice()
    list[i] = { ...list[i]!, rowMode: rowMode.value, data: clonePlot(plot) }
    plots.value = list
  }
  function loadPlot(p: PlotEntry) {
    activePlotId.value = p.id
    Object.assign(plot, emptyPlot(), clonePlot(p.data))
    rowMode.value = p.rowMode ?? (plot.rows.some((r) => r.path) ? 'keyline' : 'straight')
    drawPts.value = []
    orientPts.value = []
    inspect.value = null
    focusRow.value = null
    selected.value = null
    tool.value = plot.boundary.length >= 3 ? 'pan' : 'boundary'
    step.value = plot.plants.length ? 'plant' : plot.boundary.length >= 3 ? 'rows' : 'land'
    resetHist()
    version.value++
  }
  function resetPlots(list: PlotEntry[], active?: string) {
    plots.value = list
    loadPlot(list.find((p) => p.id === active) ?? list[0]!)
  }
  // each plot with its numbers, for the plot list (the active one read live)
  const plotList = computed(() => {
    version.value
    return plots.value.map((p) => {
      const active = p.id === activePlotId.value
      const data = active ? plot : p.data
      return { id: p.id, name: p.name, visible: p.visible, active, plants: data.plants.length, rows: data.rows.length, area: polyAreaM2(data.boundary) }
    })
  })
  const activePlot = computed(() => plots.value.find((p) => p.id === activePlotId.value) ?? null)
  // the other plots that are shown (dimmed on the map, alongside in the forest)
  const otherPlots = computed(() => (version.value, plots.value.filter((p) => p.visible && p.id !== activePlotId.value)))
  function newPlot(label?: string) {
    commitActive()
    const p: PlotEntry = { id: pid(), name: label || `Plot ${plots.value.length + 1}`, visible: true, data: { ...emptyPlot(), rowSpacing: plot.rowSpacing } }
    plots.value = [...plots.value, p]
    loadPlot(p)
    scheduleSave()
    say(`${p.name}: tap its corners on the map, or import a KML.`)
    return p
  }
  function activatePlot(id: string) {
    if (id === activePlotId.value) return
    commitActive()
    const p = plots.value.find((x) => x.id === id)
    if (!p) return
    plots.value = plots.value.map((x) => (x.id === id ? { ...x, visible: true } : x))
    loadPlot(p)
    if (plot.boundary.length >= 3) fitRequest.value++
    scheduleSave()
    say(`Now editing ${p.name}.`)
  }
  function renamePlot(id: string, label: string) {
    plots.value = plots.value.map((p) => (p.id === id ? { ...p, name: label.trim() || p.name } : p))
    version.value++
    scheduleSave()
  }
  function togglePlotVis(id: string) {
    if (id === activePlotId.value) return // the plot you're editing is always shown
    plots.value = plots.value.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p))
    version.value++
    scheduleSave()
  }
  function setAllPlotsVis(v: boolean) {
    plots.value = plots.value.map((p) => ({ ...p, visible: v || p.id === activePlotId.value }))
    version.value++
    scheduleSave()
  }
  function deletePlot(id: string) {
    const rest = plots.value.filter((p) => p.id !== id)
    if (!rest.length) {
      resetPlots([{ id: pid(), name: 'Plot 1', visible: true, data: emptyPlot() }])
    } else if (id === activePlotId.value) {
      plots.value = rest
      loadPlot(rest[0]!)
      if (plot.boundary.length >= 3) fitRequest.value++
    } else {
      plots.value = rest
      version.value++
    }
    scheduleSave()
  }
  // a tap on the map inside another plot's land: which plot was it?
  function plotAt(ll: LL) {
    for (const p of otherPlots.value) {
      if (p.data.boundary.length < 3) continue
      const F = frameAt(llCentroid(p.data.boundary))
      if (pointInPoly(F.toM(ll.lat, ll.lng), p.data.boundary.map((q) => F.toM(q.lat, q.lng)))) return p.id
    }
    return null
  }
  // a plant by id, in whichever visible plot it's in
  function findPlant(id: string) {
    return plot.plants.find((x) => x.id === id) ?? otherPlots.value.flatMap((p) => p.data.plants).find((x) => x.id === id) ?? null
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
    say(`${rows.length} rows follow your keyline at ${fmtDist(plot.rowSpacing, imperial.value)}.`)
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
    const grid = new Map<string, { x: number; y: number; sp: LibSpecies; sup: boolean }[]>()
    const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
    const add = (ll: LL, sp: LibSpecies, sup = false) => {
      const m = F.toM(ll.lat, ll.lng)
      const k = key(m.x, m.y)
      const c = grid.get(k)
      if (c) c.push({ ...m, sp, sup })
      else grid.set(k, [{ ...m, sp, sup }])
    }
    // support plants are pruned hard, so they may stand closer: half the usual clearance to a crop, and closer still
    // to each other (their spacing then comes from the chosen density, not their wild crown size)
    const free = (ll: LL, sp: LibSpecies, sup = false) => {
      const m = F.toM(ll.lat, ll.lng)
      const cx = Math.floor(m.x / CELL)
      const cy = Math.floor(m.y / CELL)
      for (let gx = cx - 2; gx <= cx + 2; gx++) {
        for (let gy = cy - 2; gy <= cy + 2; gy++) {
          for (const o of grid.get(`${gx},${gy}`) ?? []) {
            const k = sup && o.sup ? 0.35 : sup || o.sup ? 0.5 : 1
            if (Math.hypot(o.x - m.x, o.y - m.y) < clearance(sp, o.sp) * k) return false
          }
        }
      }
      return true
    }
    for (const p of plot.plants) {
      const sp = libById.get(p.speciesId)
      if (sp) add(p, sp, p.role === 'support')
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

  // ── the support layer (see utils/support.ts) ──
  // the picks follow the site until the person changes them
  function ensureSupportPicks() {
    const key = site.value ? `${site.value.lat},${site.value.lon}` : ''
    if (key === supportPicksFor) return
    supportPicksFor = key
    Object.assign(supportCfg.picks, defaultPicks(site.value))
  }
  // Lay the support species into the gaps between the crops along every row (tall support first), and if asked,
  // as hedgerows down the middle of each alley. Replaces the support layer that was there; crops are never moved.
  function plantSupport() {
    if (!plot.rows.length) return say('Lay out rows first.')
    const order: ('E' | 'H' | 'M' | 'L')[] = ['E', 'H', 'M', 'L']
    const chosen = order.map((c) => supportCfg.picks[c]).map((id) => (id ? libById.get(id) : undefined)).filter((x): x is LibSpecies => !!x)
    if (!chosen.length) return say('Choose at least one support species.')
    plot.plants = plot.plants.filter((p) => p.role !== 'support')
    const guard = makeGuard()
    const poly = plot.boundary.length >= 3 ? plot.boundary : null
    const F = poly ? frameAt(llCentroid(poly)) : null
    const polyM = poly && F ? poly.map((p) => F.toM(p.lat, p.lng)) : null
    const inside = (ll: LL) => !polyM || pointInPoly(F!.toM(ll.lat, ll.lng), polyM)
    let n = 0
    const place = (ll: LL, sp: LibSpecies, rowIdx: number) => {
      if (!inside(ll) || !guard.free(ll, sp, true)) return false
      guard.add(ll, sp, true)
      plot.plants.push({ id: nid(), speciesId: sp.id, lat: ll.lat, lng: ll.lng, rowIdx, role: 'support' })
      n++
      return true
    }
    chosen.forEach((sp, si) => {
      const gap = supportGap(sp, supportCfg.density)
      // herbs and ground-level support sit across the bed, alternating sides; trees and shrubs on the row line
      const across = sp.form === 'herb' ? 0.5 : 0
      for (const r of plot.rows) {
        const smp = pathSampler(rowPath(r))
        let k = r.idx
        for (let d = gap * (0.3 + si * 0.17); d <= smp.total - gap * 0.2 + 1e-6; d += gap, k++) {
          for (const f of [0, 0.25, -0.25, 0.45, -0.45]) {
            const x = d + f * gap
            if (x < 0 || x > smp.total) continue
            const ll = across ? offsetAcross(smp, x, (k % 2 ? 1 : -1) * across) : smp.at(x)
            if (place(ll, sp, r.idx)) break
          }
        }
      }
    })
    // hedgerows down the middle of each alley: the woody support only, at its own spacing
    if (supportCfg.between) {
      const woody = chosen.filter((sp) => sp.form !== 'herb')
      for (const r of plot.rows) {
        const smp = pathSampler(rowPath(r))
        woody.forEach((sp, si) => {
          const gap = supportGap(sp, supportCfg.density) * 1.2
          for (let d = gap * (0.5 + si * 0.21); d <= smp.total; d += gap) place(offsetAcross(smp, d, plot.rowSpacing / 2), sp, r.idx)
        })
      }
    }
    changed()
    const crops = plot.plants.length - n
    say(`🌿 ${n.toLocaleString()} support plants${crops ? `, about ${(n / crops).toFixed(1)} for every crop plant` : ''}. Prune them hard as the crops grow.`, 5500)
  }
  function clearSupport() {
    plot.plants = plot.plants.filter((p) => p.role !== 'support')
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
  // Byron's v3 formats, so files move between his designer and this one in both directions:
  //   project → { v: 3, plots: [...], activePlotId }      every plot (his "Project JSON")
  //   plot    → { v: 3, single: true, plot: {...} }      just the plot being edited (his "Plot JSON")
  const byronCanopy = () => Object.fromEntries(Object.entries(canopy).map(([id, w]) => [toByron.get(id) ?? id, w]))
  const toFile = (data: PlotData) => ({ ...clonePlot(data), plants: data.plants.map((p) => ({ ...p, speciesId: toByron.get(p.speciesId) ?? p.speciesId })) })
  function exportJSON() {
    commitActive()
    const out = {
      v: 3, name: name.value,
      plots: plots.value.map((p) => ({ id: p.id, name: p.name, visible: p.visible, ...toFile(p.data) })), activePlotId: activePlotId.value, uid,
      canopyOverrides: byronCanopy(),
      designafoodforest: { geo: geo.value, site: site.value, rowMode: rowMode.value, rowModes: Object.fromEntries(plots.value.map((p) => [p.id, p.rowMode ?? 'straight'])), yields },
    }
    download(JSON.stringify(out, null, 2), fileSafe(name.value) + '.json', 'application/json')
  }
  function exportPlotJSON() {
    const p = activePlot.value
    const out = { v: 3, single: true, plot: { name: p?.name ?? name.value, visible: true, ...toFile(plot) }, canopyOverrides: byronCanopy() }
    download(JSON.stringify(out, null, 2), fileSafe(`${name.value} ${p?.name ?? ''}`) + '.json', 'application/json')
  }
  // A project file opens as a design with all its plots. A single-plot file opens as a new design from the title,
  // and is added as another plot when a design is already open (as in Byron's designer).
  async function importJSONFile(f: File) {
    try {
      // species ids are checked against the library, so wait for it to arrive from the database first
      if (libState.value === 'loading') say('Loading the species library…')
      await libraryReady
      if (libState.value !== 'ready') return say('The species library is unavailable right now, so the file can\'t be opened. Try again in a minute.')
      const d = JSON.parse(await f.text())
      const project = Array.isArray(d.plots) && d.plots.length > 0
      const one = !project ? d.plot ?? (d.boundary || d.plants || d.rows ? d : null) : null
      if (!project && !one) return say('That file isn\'t a design we recognise.')
      // Byron's species ids are sp_<name>_<strata>; ours are <name>-<strata>
      const conv = (id: string) => (libById.has(id) ? id : fromByron.get(id) ?? id.replace(/^sp_/, '').replace(/_/g, '-'))
      const ex = d.designafoodforest
      let lost = 0
      const norm = (p: any, i: number, fresh = false): PlotEntry => {
        const plants: Plant[] = (p.plants ?? []).map((x: Plant) => ({ ...x, speciesId: conv(x.speciesId) }))
        const kept = plants.filter((x) => libById.has(x.speciesId))
        lost += plants.length - kept.length
        const data: PlotData = {
          boundary: p.boundary ?? [], fillZone: p.fillZone ?? [], rowDir: p.rowDir ?? 0, rowSpacing: p.rowSpacing || 3, rows: p.rows ?? [], plants: kept, lines: p.lines ?? [],
        }
        const id = fresh || !p.id ? pid() : String(p.id)
        return { id, name: p.name || `Plot ${i + 1}`, visible: p.visible !== false, rowMode: ex?.rowModes?.[p.id] ?? (data.rows.some((r) => r.path) ? 'keyline' : 'straight'), data }
      }
      // Byron's per-species canopy widths for this design (his ids → ours)
      const overrides: Record<string, number> = Object.fromEntries(
        Object.entries((d.canopyOverrides ?? {}) as Record<string, number>).map(([id, w]) => [conv(id), Number(w)] as const).filter(([id, w]) => libById.has(id) && w > 0),
      )
      const custom = d.customSp?.length ? `, custom species aren't carried over` : ''
      const skipped = () => (lost ? ` (${lost} plants of unknown species skipped${custom})` : '')
      // a single plot while a design is open: add it alongside
      if (one && stage.value === 'map' && geo.value) {
        commitActive()
        if (Object.keys(overrides).length) setCanopyOverrides({ ...canopy, ...overrides })
        const e = norm(one, plots.value.length, true)
        plots.value = [...plots.value, e]
        loadPlot(e)
        uid = Math.max(uid, d.uid ?? 1, plot.plants.length + 1)
        if (plot.boundary.length >= 3) fitRequest.value++
        changed(false)
        return say(`Added “${e.name}” as a new plot${skipped()}.`, 5000)
      }
      const list = project ? (d.plots as any[]).map((p, i) => norm(p, i)) : [norm(one, 0)]
      const pts = list.flatMap((p) => (p.data.boundary.length ? p.data.boundary : p.data.plants))
      const at = pts.length ? llCentroid(pts) : null
      const first = list.find((p) => p.id === d.activePlotId) ?? list[0]!
      // Byron's project files carry no name of their own: a project is named after its file, a lone plot after itself
      const fileName = f.name.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim()
      const title = d.name || (project && list.length > 1 ? fileName : first.name) || fileName || 'Imported design'
      const g: GeoResult | null = ex?.geo ?? (at ? { label: title, full: title, lat: at.lat, lon: at.lng, country: '' } : null)
      if (!g) return say('That design has no location.')
      startDesign(g)
      setCanopyOverrides(overrides)
      name.value = title
      if (ex?.yields) Object.assign(yields, ex.yields)
      uid = Math.max(uid, d.uid ?? 1, list.reduce((a, p) => a + p.data.plants.length, 0) + 1)
      resetPlots(list, d.activePlotId)
      fitRequest.value++
      changed(false)
      say(`Opened “${name.value}”${list.length > 1 ? ` with ${list.length} plots` : ''}${skipped()}.`, 5000)
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
    commitActive()
    const entry: SavedDesign = {
      id: currentId.value ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.value || geo.value.label, savedAt: Date.now(), geo: geo.value, climate: climate.value,
      // the active plot is stored once, as `plot` (which older versions read); its place in `plots` is left empty
      plot: clonePlot(plot), plots: plots.value.map((p) => (p.id === activePlotId.value ? { ...p, data: emptyPlot() } : p)), activePlotId: activePlotId.value,
      rowMode: rowMode.value, view: mapView.value, yields: JSON.parse(JSON.stringify(yields)), canopy: { ...canopy }, uid,
    }
    // nothing worth keeping until there's a boundary or a plant
    if (!plots.value.some((p) => p.data.boundary.length || p.data.plants.length)) return
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
    const list = sv.plots?.length ? sv.plots.map((p) => (p.id === sv.activePlotId ? { ...p, data: sv.plot } : p)) : [{ id: activePlotId.value, name: 'Plot 1', visible: true, rowMode: sv.rowMode, data: sv.plot }]
    setCanopyOverrides(sv.canopy ?? {})
    resetPlots(list.map((p) => ({ ...p, data: { ...emptyPlot(), ...p.data } })), sv.activePlotId)
    Object.assign(yields, sv.yields ?? {})
    uid = sv.uid ?? plot.plants.length + 1
    mapView.value = sv.view
    ui.saves = false
  }
  function deleteSave(id: string) {
    if (currentId.value === id) currentId.value = null
    writeSaves(saves.value.filter((x) => x.id !== id))
  }

  // ── 3D: the design in scene metres (x = east, z = south), centred on the land ──
  // Every visible plot is in the scene (so you can walk from one to the next); the one being edited is `poly`.
  const scene = computed(() => {
    version.value
    libVersion.value
    const showSup = ui.showSupport
    const shown: PlotData[] = [plot, ...otherPlots.value.map((p) => p.data)]
    const bounds = shown.flatMap((p) => (p.boundary.length >= 3 ? p.boundary : []))
    const loose = bounds.length ? [] : shown.flatMap((p) => p.plants)
    const pts = bounds.length ? bounds : loose.length ? loose : null
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
    const plants: { s: number; x: number; z: number; id: string; rank: number; sup: boolean }[] = []
    // Thinning is managed, not random: along each row a species is thinned to every other plant, then every
    // fourth…, and neighbouring rows are staggered (van der Corput order of the plant's place in its row).
    const seq = new Map<string, number>()
    const vdc = (n: number) => {
      let r = 0
      let f = 0.5
      for (; n; n >>= 1, f /= 2) if (n & 1) r += f
      return r
    }
    shown.forEach((pd, pi) => pd.plants.forEach((p) => {
      const sp = libById.get(p.speciesId)
      if (!sp || (!showSup && p.role === 'support')) return
      let s = index.get(sp.id)
      if (s === undefined) {
        s = species.length
        index.set(sp.id, s)
        species.push(sp)
      }
      const [x, z] = xz(p)
      const sk = `${pi}|${p.speciesId}|${p.rowIdx}`
      const k = seq.get(sk) ?? 0
      seq.set(sk, k + 1)
      plants.push({ s, x, z, id: p.id, rank: vdc(k + Math.max(0, p.rowIdx)), sup: p.role === 'support' })
    }))
    return {
      origin,
      toLL: (x: number, z: number) => F.toLL(x, -z),
      toXZ: xz,
      width: Math.max(8, maxX - minX),
      depth: Math.max(8, maxY - minY),
      poly: plot.boundary.map(xz),
      polys: shown.slice(1).filter((p) => p.boundary.length >= 3).map((p) => p.boundary.map(xz)), // the other plots
      rows: shown.flatMap((pd) => pd.rows.map((r) => rowPath(r).map(xz))),
      lines: shown.flatMap((pd) => pd.lines.map((l) => l.points.map(xz))),
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
    stage, clock, geo, climate, climateLoading, locating, error, alternatives, flyRequest, relocate, site, weather, env, plot, rowMode, name, step, tool, selSpId, selSp, fillMode, drawPts, orientPts,
    inspect, focusRow, year, selected, yields, dash, ui, input, toast, saves, currentId, mapView, forestFocus, version, fitRequest, lastBlocked, histState, areaM2, imperial, setUnits,
    cards, fits, counts, inUse, rowMetres, canopyShare, scene,
    say, undo, redo, changed, locate, startDesign, readClimate, setTool, addPoint, finishDraw, setBoundary, clearBoundary, setRowDir, setRowSpacing, setRowMode,
    orientFrom, fillFromKeyline, clearKeylines, offsetKeyline, placeAt, eraseAt, inspectAt, plantNear, fillRows, applyRecipe, clearRow, clearSpecies, clearPlants,
    supportCfg, supportCount, ensureSupportPicks, plantSupport, clearSupport,
    canopy, setSpeciesCanopy: (id: string, w: number | null) => (setCanopy(id, w), changed(false)),
    plots, activePlotId, activePlot, plotList, otherPlots, newPlot, activatePlot, renamePlot, togglePlotVis, setAllPlotsVis, deletePlot, plotAt, findPlant, exportPlotJSON,
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
