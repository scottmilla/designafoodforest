<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import L from 'leaflet'
import type { LL } from '#shared/types'
import { libById } from '~/utils/library'
import { nearestRow } from '~/utils/geo'
import { paint } from '~/utils/paint'

// The satellite designer. Leaflet carries the photo (Esri World Imagery, sharp to zoom 19); our canvas paints
// the design over it. Zoom past where the photo goes soft and you dive into the 3D forest instead.
const d = useDesign()
const el = ref<HTMLDivElement | null>(null)
const nearDive = ref(false)
let map: L.Map | null = null
let sat: L.TileLayer | null = null
let canvas: HTMLCanvasElement | null = null
let mouse: LL | null = null
let raf = 0
const DIVE_ZOOM = 21

function mpp() {
  if (!map) return 1
  const c = map.getCenter()
  const c2 = L.latLng(c.lat, c.lng + 0.0009)
  const a = map.latLngToContainerPoint(c)
  const b = map.latLngToContainerPoint(c2)
  const px = Math.hypot(b.x - a.x, b.y - a.y)
  return px > 0 ? map.distance(c, c2) / px : 1
}

function render() {
  raf = 0
  if (!map || !canvas) return
  const size = map.getSize()
  const dpr = window.devicePixelRatio || 1
  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
  if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
    canvas.width = size.x * dpr
    canvas.height = size.y * dpr
    canvas.style.width = size.x + 'px'
    canvas.style.height = size.y + 'px'
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const m = mpp()
  const sp = d.tool.value === 'place' ? d.selSp.value : null
  let ghost = null
  if (sp && mouse) {
    const sn = nearestRow(d.plot.rows, mouse, d.plot.rowSpacing / 2)
    ghost = { sp, at: sn?.ll ?? mouse }
  }
  const P = (ll: LL) => map!.latLngToContainerPoint([ll.lat, ll.lng])
  paint(ctx, size.x, size.y, P, m, {
    plot: { ...toRaw(d.plot), plants: toRaw(d.plot.plants) },
    lib: libById, fits: d.fits.value, labels: d.ui.labels, tool: d.tool.value, step: d.step.value === 'rows' && d.rowMode.value === 'straight' ? 'rows' : d.step.value,
    drawPts: d.drawPts.value, orientPts: d.orientPts.value, mouse, ghost, focusRow: d.focusRow.value, inspect: d.inspect.value,
  })
}
const refresh = () => (raf ||= requestAnimationFrame(render))

function toLL(e: L.LeafletMouseEvent): LL {
  return { lat: e.latlng.lat, lng: e.latlng.lng }
}
function onClick(e: L.LeafletMouseEvent) {
  const ll = toLL(e)
  const tol = 14 * mpp()
  switch (d.tool.value) {
    case 'boundary':
    case 'keyline':
    case 'zone': {
      const pts = d.drawPts.value
      // tapping the first corner closes the shape
      if (pts.length >= 3 && d.tool.value !== 'keyline') {
        const a = map!.latLngToContainerPoint([pts[0]!.lat, pts[0]!.lng])
        if (a.distanceTo(e.containerPoint) < 16) return d.finishDraw()
      }
      const last = pts[pts.length - 1]
      if (last && map!.latLngToContainerPoint([last.lat, last.lng]).distanceTo(e.containerPoint) < 6) return
      d.addPoint(ll)
      break
    }
    case 'orient':
      d.orientPts.value = [...d.orientPts.value, ll]
      if (d.orientPts.value.length === 2) {
        d.orientFrom(d.orientPts.value[0]!, d.orientPts.value[1]!)
        d.orientPts.value = []
      }
      break
    case 'place':
      d.placeAt(ll)
      break
    case 'erase':
      d.eraseAt(ll, tol)
      break
    case 'fillrow': {
      const r = nearestRow(d.plot.rows, ll, Math.max(tol, d.plot.rowSpacing / 2))
      if (r && d.selSpId.value) {
        const n = d.fillRows(d.selSpId.value, r.row)
        d.focusRow.value = r.row
        d.say(`Row ${r.row + 1}: ${n} × ${d.selSp.value?.name}`)
      }
      break
    }
    default:
      d.inspectAt(ll, tol)
  }
  refresh()
}

function syncView() {
  if (!map) return
  const lb = landBounds()
  if (lb && !map.getBounds().intersects(lb)) return // never remember a view that has lost the land
  const c = map.getCenter()
  d.mapView.value = { lat: c.lat, lng: c.lng, zoom: map.getZoom() }
}

onMounted(() => {
  const v = d.mapView.value ?? (d.geo.value ? { lat: d.geo.value.lat, lng: d.geo.value.lon, zoom: 18 } : { lat: 37.694, lng: -122.073, zoom: 16 })
  map = L.map(el.value!, { zoomControl: false, doubleClickZoom: false, maxZoom: DIVE_ZOOM, zoomSnap: 0.5, attributionControl: true })
  sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Imagery © Esri, Maxar, Earthstar', maxZoom: DIVE_ZOOM, maxNativeZoom: 19, opacity: d.ui.sat,
  }).addTo(map)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: DIVE_ZOOM, maxNativeZoom: 19, opacity: 0.45,
  }).addTo(map)
  L.control.zoom({ position: 'bottomleft' }).addTo(map)

  const Overlay = L.Layer.extend({
    onAdd(m: L.Map) {
      canvas = L.DomUtil.create('canvas', 'design-ov') as HTMLCanvasElement
      canvas.style.position = 'absolute'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '450'
      m.getPanes().overlayPane.appendChild(canvas)
      m.on('move zoom moveend zoomend resize viewreset', render)
      render()
    },
    onRemove(m: L.Map) {
      if (canvas) L.DomUtil.remove(canvas)
      m.off('move zoom moveend zoomend resize viewreset', render)
    },
  })
  new Overlay().addTo(map)

  // arriving from the title: a little descent from the sky onto the land
  if (d.plot.boundary.length >= 3 && !d.mapView.value) {
    map.fitBounds(L.latLngBounds(d.plot.boundary.map((p) => [p.lat, p.lng])), { padding: [60, 60] })
  } else if (v.zoom >= 17 && d.stage.value === 'map' && !d.plot.boundary.length) {
    map.setView([v.lat, v.lng], v.zoom - 3)
    setTimeout(() => map?.flyTo([v.lat, v.lng], v.zoom, { duration: 2.2 }), 250)
  } else {
    map.setView([v.lat, v.lng], Math.min(v.zoom, 20.5), { animate: false })
  }

  // a saved design always opens with its land on screen, laid out exactly as drawn
  ensureLandInView()
  map.on('click', onClick)
  map.on('mousemove', (e: L.LeafletMouseEvent) => {
    mouse = toLL(e)
    if (d.tool.value === 'place' || d.drawPts.value.length || d.orientPts.value.length) refresh()
  })
  map.on('mouseout', () => {
    mouse = null
    refresh()
  })
  map.on('dblclick', () => {
    if (['boundary', 'keyline', 'zone'].includes(d.tool.value)) d.finishDraw()
  })
  map.on('moveend', syncView)
  map.on('zoomend', () => {
    syncView()
    const z = map!.getZoom()
    nearDive.value = z >= DIVE_ZOOM - 1
    // past the photo's resolution: step inside instead of staring at blurry pixels
    if (z >= DIVE_ZOOM) {
      const c = map!.getCenter()
      d.enterForest({ lat: c.lat, lng: c.lng })
    }
  })
  setTimeout(() => {
    map?.invalidateSize()
    refresh()
  }, 200)
  window.addEventListener('resize', onResize)
  if (import.meta.dev) (window as any).__map = map
})
const onResize = () => {
  map?.invalidateSize()
  refresh()
}
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(raf)
  map?.remove()
  map = null
})

watch([d.version, d.tool, d.drawPts, d.orientPts, d.selSpId, () => d.ui.labels, d.focusRow, d.inspect, d.step, d.rowMode, d.fits], refresh)
watch(() => d.ui.sat, (o) => sat?.setOpacity(o))
watch(d.tool, (t) => {
  if (!el.value) return
  el.value.style.cursor = t === 'pan' ? '' : t === 'erase' ? 'pointer' : 'crosshair'
})
// a fresh boundary: frame it, leaving room for the step card on the right
watch(d.fitRequest, () => fit())
// another design opened while the map is up: show it as it was saved, or frame its land
watch(d.geo, () => {
  if (!map) return
  const v = d.mapView.value
  if (v) map.setView([v.lat, v.lng], v.zoom, { animate: false })
  const b = landBounds()
  if (b && (!v || !map.getBounds().intersects(b))) fit(false)
})

// everything the design has drawn, as map bounds (boundary, rows, keylines, plants)
function landBounds() {
  const pts: [number, number][] = []
  for (const p of d.plot.boundary) pts.push([p.lat, p.lng])
  if (!pts.length) {
    for (const p of d.plot.plants) pts.push([p.lat, p.lng])
    for (const l of d.plot.lines) for (const p of l.points) pts.push([p.lat, p.lng])
  }
  return pts.length ? L.latLngBounds(pts) : null
}
function fit(animate = true) {
  const b = landBounds()
  if (!map || !b) return
  const size = map.getSize()
  // room for the step card on the right, but never more than a third of a small window
  const card = d.ui.mobile ? 0 : Math.min((document.querySelector('.step-dock .card')?.getBoundingClientRect().width ?? 520) + 60, size.x * 0.45)
  const opts = { paddingTopLeft: L.point(40, 90), paddingBottomRight: L.point(Math.max(20, card), d.ui.mobile ? size.y * 0.48 : 40), maxZoom: 20 }
  if (animate) map.flyToBounds(b, { ...opts, duration: 1.1 })
  else map.fitBounds(b, { ...opts, animate: false })
}
// a view that doesn't show the land at all is never right: re-frame it
function ensureLandInView() {
  const b = landBounds()
  if (map && b && !map.getBounds().intersects(b)) fit(false)
}
function diveHere() {
  if (!map) return
  const c = map.getCenter()
  d.enterForest({ lat: c.lat, lng: c.lng })
}
defineExpose({ fit, diveHere })
</script>

<template>
  <div class="map-wrap">
    <div ref="el" class="map" />
    <Transition name="toast">
      <p v-if="nearDive" class="dive-hint">🌳 One more zoom to step inside your forest</p>
    </Transition>
  </div>
</template>
