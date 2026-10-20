<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { Color, Group, IcosahedronGeometry, MeshStandardMaterial, type InstancedMesh } from 'three'
import type { Form, LibSpecies } from '#shared/types'
import { canopyGeometry, canopyScaleFor, FORMS, hash, makeInstanced, seasonalLeaf, setInstance, swayMaterial, trunkGeometry, TRUNK_FRAC } from '~/utils/plantGeo'
import { crownLift, monthsIn, plantGrowth, thinnedShare } from '~/utils/growth'
import { managedWidth } from '~/utils/library'

// The design's plants, drawn as instanced meshes (one per plant form + trunks + fruit). Sizes come straight
// from the Codex dimensions; growth, thinning and fruiting follow the year slider.
const s = useDesign()
type Scene = ReturnType<typeof useDesign>['scene']['value']
const player = usePlayer()
const group = new Group()

const canopyGeo = Object.fromEntries(FORMS.map((f) => [f, canopyGeometry(f)])) as Record<Form, ReturnType<typeof canopyGeometry>>
const trunkGeo = trunkGeometry()
const fruitGeo = new IcosahedronGeometry(1, 1)
const leafMat = swayMaterial({ color: '#ffffff', roughness: 0.75 })
const trunkMat = swayMaterial({ color: '#ffffff', roughness: 0.9 }, 0.15)
const fruitMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, flatShading: true, emissive: '#331100', emissiveIntensity: 0.15 })

let canopies: Partial<Record<Form, InstancedMesh>> = {}
let canopyIds: Partial<Record<Form, Int32Array>> = {}
let trunks: InstancedMesh | null = null
let trunkIds = new Int32Array(0)
let fruit: InstancedMesh | null = null
let current: Scene | null = null
let delays = new Float32Array(0)
let rot = new Float32Array(0)
let growStart = -1
let dirty = true
let elapsedNow = 0
// distance to the nearest living neighbour in the same stratum: canopies are managed (pruned) to fit it,
// so trees in a line stay separate instead of growing into each other as the years pass
let room = new Float32Array(0)
let roomYear = NaN

// nearest living neighbour in the same layer, found through a coarse grid (designs run to tens of thousands of plants)
const CELL = 8
function computeRoom(d: Scene, year: number) {
  const n = d.plants.length
  room = new Float32Array(n).fill(Infinity)
  const grid = new Map<string, number[]>()
  d.plants.forEach((p, i) => {
    if (plantGrowth(d.species[p.s]!, year, d.plants[i]!.rank) <= 0.001) return
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
    const cell = grid.get(k)
    if (cell) cell.push(i)
    else grid.set(k, [i])
  })
  for (const [k, cell] of grid) {
    const [cx, cz] = k.split(',').map(Number) as [number, number]
    for (const i of cell) {
      const pi = d.plants[i]!
      const st = d.species[pi.s]!.layer
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          for (const j of grid.get(`${gx},${gz}`) ?? []) {
            if (j <= i) continue
            const pj = d.plants[j]!
            if (d.species[pj.s]!.layer !== st) continue
            const dist = Math.hypot(pi.x - pj.x, pi.z - pj.z)
            if (dist < 0.05) continue // the same spot twice (overlapping plots): not a neighbour to make room for
            if (dist < room[i]!) room[i] = dist
            if (dist < room[j]!) room[j] = dist
          }
        }
      }
    }
  }
  roomYear = year
}

function dispose() {
  for (const m of [...Object.values(canopies), trunks, fruit]) if (m) { group.remove(m); m.dispose() }
  canopies = {}
  canopyIds = {}
  trunks = fruit = null
}

function build(d: Scene | null) {
  dispose()
  current = d
  if (!d || !d.plants.length) return
  const n = d.plants.length
  const perForm: Partial<Record<Form, number>> = {}
  for (const p of d.plants) {
    const f = d.species[p.s]!.form
    perForm[f] = (perForm[f] ?? 0) + 1
  }
  for (const f of FORMS) {
    if (!perForm[f]) continue
    const m = makeInstanced(canopyGeo[f], leafMat, perForm[f]!)
    m.userData.pick = 'plant'
    canopyIds[f] = new Int32Array(perForm[f]!)
    m.userData.ids = canopyIds[f]
    canopies[f] = m
    group.add(m)
  }
  trunks = makeInstanced(trunkGeo, trunkMat, n)
  trunks.userData.pick = 'plant'
  trunkIds = new Int32Array(n)
  trunks.userData.ids = trunkIds
  fruit = makeInstanced(fruitGeo, fruitMat, n * 7)
  group.add(trunks, fruit)
  // ripple outward from wherever the person is standing
  delays = new Float32Array(n)
  rot = new Float32Array(n)
  const maxD = Math.hypot(d.width, d.depth) || 1
  d.plants.forEach((p, i) => {
    delays[i] = (Math.hypot(p.x - player.x, p.z - player.z) / maxD) * 1.4 + hash(i) * 0.15
    rot[i] = hash(i * 7 + 3) * Math.PI * 2
  })
  roomYear = NaN
  growStart = elapsedNow
  dirty = true
}

const leaf = new Color()
const fruitC = new Color()
const bark = new Color()
const BARK = ['#7a4e2d', '#6b4a35', '#8a5a3a', '#5e4636']

function update(anim: number) {
  const d = current
  if (!d || !trunks || !fruit) return
  const env = s.env.value
  const year = s.year.value
  const month = env.month
  const south = (s.site.value?.lat ?? 0) < 0
  const crown = s.ui.crown
  const counters: Partial<Record<Form, number>> = {}
  let ti = 0
  let fi = 0
  const t = elapsedNow - growStart
  if (roomYear !== year) computeRoom(d, year)
  const colorPass = dirty
  d.plants.forEach((p, i) => {
    const sp: LibSpecies = d.species[p.s]!
    const g0 = plantGrowth(sp, year, d.plants[i]!.rank)
    let a = 1
    if (anim) {
      const k = Math.min(1, Math.max(0, (t - delays[i]!) / 0.7))
      a = k === 0 ? 0 : 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2 // ease-out-back
    }
    const g = g0 * a
    const f = sp.form
    // pollarded support trees are cut back every year or two: show them as pruned crowns
    // and so is the support layer, chopped and dropped to feed the crops
    const cut = sp.pollard && sp.form !== 'pollard' ? 0.55 : p.sup ? 0.65 : 1
    const h = Math.max(0.05, sp.heightM * g * (cut < 1 ? 0.75 : 1))
    const cs = canopyScaleFor(sp.deciduous, env.season, env.lush)
    // syntropic systems keep big canopies pruned; drawing them at full wild spread would hide everything below
    // The Codex's Target RS is the spacing at which a crop's crowns just meet, so a managed crown never needs to be
    // wider than that. `crown` (the slider) trims further, and a crown always leaves room for the nearest same-layer neighbour.
    // as neighbours are thinned out the survivors' crowns widen toward their natural spread and close the gap
    const natural = Math.min(sp.widthM, 3 + sp.widthM * 0.45)
    const managed = managedWidth(sp) + (natural - managedWidth(sp)) * Math.min(1, thinnedShare(sp, year) / 0.25)
    const w = Math.max(0.15, Math.min(managed * crown * g * cut, room[i]! * crown))
    const ci = (counters[f] = (counters[f] ?? -1) + 1)
    const cm = canopies[f]!
    canopyIds[f]![ci] = i
    if (g <= 0.001) setInstance(cm, ci, p.x, -50, p.z, 0.001, 0.001, 0.001)
    else if (TRUNK_FRAC[f] > 0 && f !== 'palm' && f !== 'pollard') {
      // as the tree ages the crown lifts up the trunk (up to ~22% of the height) and gets proportionally less deep
      const lift = 0.22 * crownLift(g0)
      setInstance(cm, ci, p.x, h * lift, p.z, w * cs, h * (1 - lift) * (cs < 1 ? 0.9 : 1), w * cs, rot[i])
    } else setInstance(cm, ci, p.x, 0, p.z, w * cs, h * (cs < 1 ? 0.9 : 1), w * cs, rot[i])
    if (colorPass) {
      seasonalLeaf(sp.leaf, sp.deciduous, env.season, env.lush, (i * 13 + p.s * 7) % 97, leaf)
      leaf.offsetHSL((hash(i) - 0.5) * 0.03, 0, (hash(i + 1) - 0.5) * 0.08)
      cm.setColorAt(ci, leaf)
    }
    const tf = TRUNK_FRAC[f]
    if (tf > 0 && g > 0.001) {
      const th = h * (tf + (f !== 'palm' && f !== 'pollard' ? 0.22 * crownLift(g0) : 0))
      const tw = f === 'palm' ? 0.22 + h * 0.012 : f === 'vine' ? 0.12 : 0.18 + h * 0.03
      setInstance(trunks!, ti, p.x, 0, p.z, tw, th, tw, rot[i])
      trunkIds[ti] = i
      if (colorPass || anim) trunks!.setColorAt(ti, bark.set(f === 'vine' ? '#9a7a5a' : BARK[i % BARK.length]!))
      ti++
    }
    // fruit, fuller when it's harvest season at the site
    if (sp.fruit && sp.food && year >= sp.yearsToFruit && g > 0.3 && fi < fruit!.instanceMatrix.count - 7) {
      // harvest months are stored for the north; flip them for southern sites
      const inSeason = monthsIn(sp.harvest).map((m) => (south ? ((m + 5) % 12) + 1 : m)).includes(month)
      const bare = cs < 1
      const n = inSeason ? (f === 'herb' ? 3 : 6) : bare ? 0 : f === 'herb' ? 0 : 2
      const cy = f === 'palm' ? 0.86 : f === 'shrub' ? 0.45 : f === 'herb' ? 0.25 : f === 'pollard' ? 0.92 : f === 'vine' ? 0.6 : 0.62
      const rs = f === 'herb' ? 0.05 : Math.min(0.3, Math.max(0.09, 0.07 + sp.widthM * 0.018)) * (/jackfruit|durian|marang|breadfruit|cupua/i.test(sp.name) ? 2 : 1)
      for (let k = 0; k < n; k++) {
        const u = hash(i * 31 + k * 7) * Math.PI * 2
        const v = hash(i * 17 + k * 13) * 1.1 - 0.35
        const rx = w * (f === 'palm' ? 0.12 : 0.47)
        const ry = h * (f === 'herb' ? 0.2 : 0.22)
        setInstance(fruit!, fi, p.x + Math.cos(u) * rx * Math.cos(v), h * cy + Math.sin(v) * ry, p.z + Math.sin(u) * rx * Math.cos(v), rs, rs * 1.1, rs)
        fruit!.setColorAt(fi, fruitC.set(sp.fruit))
        fi++
      }
    }
  })
  for (const f of FORMS) {
    const m = canopies[f]
    if (!m) continue
    m.count = (counters[f] ?? -1) + 1
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }
  trunks.count = ti
  trunks.instanceMatrix.needsUpdate = true
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true
  trunks.computeBoundingSphere()
  fruit.count = fi
  fruit.instanceMatrix.needsUpdate = true
  if (fruit.instanceColor) fruit.instanceColor.needsUpdate = true
  dirty = false
}

watch(() => s.scene.value, (d) => build(d), { immediate: true })
watch([() => s.year.value, () => s.env.value.season, () => s.env.value.month, () => s.ui.crown], () => (dirty = true))

const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed }) => {
  elapsedNow = elapsed
  const animating = growStart >= 0 && elapsed - growStart < 2.4
  if (animating) {
    dirty = true
    update(1)
  } else if (dirty) {
    growStart = -1
    update(0)
  }
})
onBeforeUnmount(dispose)
</script>

<template>
  <primitive :object="group" />
</template>
