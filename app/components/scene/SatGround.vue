<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { CanvasTexture, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

// The same satellite photo the map showed, laid under the forest at true scale, its edges washed out
// into the painted meadow. Tiles are Esri World Imagery (served with CORS, so a canvas can read them).
const s = useDesign()
const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: '#fff6e6', roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }))
mesh.rotation.x = -Math.PI / 2
mesh.position.y = 0.02
mesh.renderOrder = 1
let tex: CanvasTexture | null = null
let gen = 0

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

function build() {
  const my = ++gen
  mesh.visible = false
  tex?.dispose()
  tex = null
  if (!s.ui.satGround) return
  const sc = s.scene.value
  const span = Math.max(sc.width, sc.depth)
  const margin = Math.max(30, span * 0.35)
  const nw = sc.toLL(-sc.width / 2 - margin, -sc.depth / 2 - margin)
  const se = sc.toLL(sc.width / 2 + margin, sc.depth / 2 + margin)
  // the sharpest zoom that keeps the photo to a sensible number of tiles
  let z = 19
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0
  for (; z >= 12; z--) {
    x0 = Math.floor(lon2x(nw.lng, z)); x1 = Math.floor(lon2x(se.lng, z))
    y0 = Math.floor(lat2y(nw.lat, z)); y1 = Math.floor(lat2y(se.lat, z))
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 64 && (x1 - x0 + 1) * 256 <= 4096 && (y1 - y0 + 1) * 256 <= 4096) break
  }
  const nx = x1 - x0 + 1
  const ny = y1 - y0 + 1
  const tiles = document.createElement('canvas')
  tiles.width = nx * 256
  tiles.height = ny * 256
  const out = document.createElement('canvas')
  out.width = tiles.width
  out.height = tiles.height
  // place the plane over exactly the tiles' footprint
  const [ax, az] = sc.toXZ({ lat: y2lat(y0, z), lng: x2lon(x0, z) })
  const [bx, bz] = sc.toXZ({ lat: y2lat(y1 + 1, z), lng: x2lon(x1 + 1, z) })
  mesh.scale.set(bx - ax, bz - az, 1)
  mesh.position.x = (ax + bx) / 2
  mesh.position.z = (az + bz) / 2
  tex = new CanvasTexture(out)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const mat = mesh.material as MeshStandardMaterial
  mat.map = tex
  mat.needsUpdate = true

  // fade the photo out toward its edges so it melts into the meadow
  const fx = (m: number) => ((m - ax) / (bx - ax)) * out.width
  const fz = (m: number) => ((m - az) / (bz - az)) * out.height
  const inner = { l: fx(-sc.width / 2 - margin * 0.35), r: fx(sc.width / 2 + margin * 0.35), t: fz(-sc.depth / 2 - margin * 0.35), b: fz(sc.depth / 2 + margin * 0.35) }
  const outer = { l: fx(-sc.width / 2 - margin), r: fx(sc.width / 2 + margin), t: fz(-sc.depth / 2 - margin), b: fz(sc.depth / 2 + margin) }
  function compose() {
    const c = out.getContext('2d')!
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, out.width, out.height)
    c.drawImage(tiles, 0, 0)
    c.globalCompositeOperation = 'destination-in'
    const ramp = (x0: number, y0: number, x1: number, y1: number) => {
      const g = c.createLinearGradient(x0, y0, x1, y1)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,1)')
      c.fillStyle = g
      c.fillRect(0, 0, out.width, out.height)
    }
    ramp(outer.l, 0, inner.l, 0)
    ramp(outer.r, 0, inner.r, 0)
    ramp(0, outer.t, 0, inner.t)
    ramp(0, outer.b, 0, inner.b)
    if (tex) tex.needsUpdate = true
  }
  let raf = 0
  const tctx = tiles.getContext('2d')!
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = img.onerror = () => {
        if (my !== gen) return
        if (img.naturalWidth) tctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256)
        // recompose at most once a frame while tiles stream in
        raf ||= requestAnimationFrame(() => {
          raf = 0
          compose()
          mesh.visible = true
        })
      }
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`
    }
  }
}

const key = () => {
  const sc = s.scene.value
  return `${sc.origin.lat.toFixed(6)},${sc.origin.lng.toFixed(6)},${Math.round(sc.width)},${Math.round(sc.depth)}`
}
watch([key, () => s.ui.satGround], build, { immediate: true })
onBeforeUnmount(() => {
  gen++
  tex?.dispose()
  mesh.geometry.dispose()
  ;(mesh.material as MeshStandardMaterial).dispose()
})
</script>

<template>
  <primitive :object="mesh" />
</template>
