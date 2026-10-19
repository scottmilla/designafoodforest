<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Shape, ShapeGeometry, TubeGeometry, Vector3, type Material,
} from 'three'

// The land itself, as drawn on the map: a painted glaze inside the boundary, stakes and rope around it,
// mulched beds along every row and golden keylines, all as soft glazes rather than hard geometry.
const s = useDesign()
const group = new Group()
const disposables: { dispose(): void }[] = []
const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

function ribbon(points: [number, number][], width: number, y: number) {
  const pos: number[] = []
  const idx: number[] = []
  points.forEach(([x, z], i) => {
    const [ax, az] = points[Math.max(0, i - 1)]!
    const [bx, bz] = points[Math.min(points.length - 1, i + 1)]!
    let dx = bx - ax
    let dz = bz - az
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    pos.push(x - (dz * width) / 2, y, z + (dx * width) / 2, x + (dz * width) / 2, y, z - (dx * width) / 2)
    if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2)
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return keep(g)
}
const glaze = (color: string, opacity: number) => keep(new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }))
const solid = (color: string) => keep(new MeshStandardMaterial({ color, flatShading: true }))

function clear() {
  group.clear()
  disposables.splice(0).forEach((d) => d.dispose())
}
function add(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  group.add(m)
  return m
}

function build() {
  clear()
  const sc = s.scene.value
  const poly = sc.poly
  if (poly.length >= 3) {
    // the glaze: a shape in the x/-z plane, laid flat
    const shape = new Shape(poly.map(([x, z]) => ({ x, y: -z }) as any))
    const flat = keep(new ShapeGeometry(shape))
    flat.rotateX(-Math.PI / 2)
    // over the satellite photo the glaze is a thin warm veil; on the painted meadow it's the bare soil
    const sat = s.ui.satGround
    add(flat, glaze(sat ? '#ffe9a8' : '#e9cf98', sat ? 0.12 : 0.5), 0, 0.03, 0)
    // stakes + rope, every ~8 m along each edge
    const stakeGeo = keep(new CylinderGeometry(0.06, 0.08, 1.1, 6))
    const stakeMat = solid('#a2693a')
    const ropeMat = keep(new MeshStandardMaterial({ color: '#f2e6c8' }))
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i]!
      const [bx, bz] = poly[(i + 1) % poly.length]!
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.round(len / 8))
      const pts: Vector3[] = []
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n
        const z = az + ((bz - az) * k) / n
        if (k < n) add(stakeGeo, stakeMat, x, 0.55, z)
        pts.push(new Vector3(x, 0.92, z))
        if (k < n) pts.push(new Vector3(x + (bx - ax) / n / 2, 0.8, z + (bz - az) / n / 2))
      }
      add(keep(new TubeGeometry(new CatmullRomCurve3(pts), n * 6, 0.025, 4)), ropeMat)
    }
  }
  // mulched beds along the rows
  const outer = glaze('#7a5232', 0.4)
  const inner = glaze('#5e3c22', 0.45)
  for (const r of sc.rows) {
    if (r.length < 2) continue
    add(ribbon(r, 1.8, 0.045), outer)
    add(ribbon(r, 1.0, 0.05), inner)
  }
  for (const l of sc.lines) if (l.length >= 2) add(ribbon(l, 0.35, 0.06), glaze('#ffcf4a', 0.85))
}

watch([() => s.scene.value, () => s.ui.satGround], build, { immediate: true })
onBeforeUnmount(clear)
</script>

<template>
  <primitive :object="group" />
</template>
