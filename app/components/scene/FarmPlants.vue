<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { Color, DoubleSide, Group, IcosahedronGeometry, MeshStandardMaterial, PlaneGeometry, type InstancedMesh } from 'three'
import type { Form, LibSpecies } from '#shared/types'
import { BARK, canopyGeometry, FORMS, hash, leafColour, leafiness, makeInstanced, scratch, setInstance, swayMaterial, trunkGeometry, TRUNK_FRAC, TWIG_BARK, TWIG_FORMS, twigGeometry } from '~/utils/plantGeo'
import { stepSeason, useSeason } from '~/composables/useSeason'
import { crownLift, crownRelease, monthsIn, plantGrowth } from '~/utils/growth'
import { managedWidth } from '~/utils/library'

// The design's plants, drawn as instanced meshes (one per plant form + trunks + fruit). Sizes come straight
// from the Codex dimensions; growth, thinning and fruiting follow the year slider. Deciduous plants follow the month
// too: bare twigs in winter, leafing out in spring, colouring and dropping their leaves in autumn (see useSeason).
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
const twigGeo = Object.fromEntries(TWIG_FORMS.map((f) => [f, twigGeometry(f)])) as Record<Form, ReturnType<typeof twigGeometry>>
const twigMat = swayMaterial({ color: '#ffffff', roughness: 0.95 }, 0.5)
// falling leaves: a few hundred small flat leaves, recycled
const LEAVES = 360
const fallGeo = new PlaneGeometry(0.3, 0.19)
const fallMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: DoubleSide, flatShading: true })
const season = useSeason()

let canopies: Partial<Record<Form, InstancedMesh>> = {}
let twigs: Partial<Record<Form, InstancedMesh>> = {}
let fall: InstancedMesh | null = null
// each falling leaf: where it is, how fast it drifts, and its colour
const fx = new Float32Array(LEAVES), fy = new Float32Array(LEAVES).fill(-1), fz = new Float32Array(LEAVES)
const fvx = new Float32Array(LEAVES), fvz = new Float32Array(LEAVES), fspin = new Float32Array(LEAVES), frest = new Float32Array(LEAVES)
let deciduous: number[] = [] // the plants that drop leaves (scene indices)
let lastLeaf = 1 // the crown amount last frame, to see when leaves are dropping
// each plant's crown this year (for dropping leaves from it): width, bottom and depth, m
let crownW = new Float32Array(0), crownY = new Float32Array(0), crownH = new Float32Array(0)
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
  for (const m of [...Object.values(canopies), ...Object.values(twigs), trunks, fruit, fall]) if (m) { group.remove(m); m.dispose() }
  canopies = {}
  twigs = {}
  fall = null
  deciduous = []
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
  // bare branches for the deciduous trees and shrubs, one mesh per form
  const perTwig: Partial<Record<Form, number>> = {}
  d.plants.forEach((p, i) => {
    const sp = d.species[p.s]!
    if (!sp.deciduous || !TWIG_FORMS.includes(sp.form)) return
    perTwig[sp.form] = (perTwig[sp.form] ?? 0) + 1
    deciduous.push(i)
  })
  for (const f of TWIG_FORMS) {
    if (!perTwig[f]) continue
    const m = makeInstanced(twigGeo[f], twigMat, perTwig[f]!)
    twigs[f] = m
    group.add(m)
  }
  if (deciduous.length) {
    fall = makeInstanced(fallGeo, fallMat, LEAVES)
    fy.fill(-1)
    group.add(fall)
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
  crownW = new Float32Array(n)
  crownY = new Float32Array(n)
  crownH = new Float32Array(n)
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

function update(anim: number) {
  const d = current
  if (!d || !trunks || !fruit) return
  const env = s.env.value
  const year = s.year.value
  const month = env.month
  const south = (s.site.value?.lat ?? 0) < 0
  const crown = s.ui.crown
  // the month as the trees show it, eased between months (see useSeason)
  const sm = Number.isFinite(season.m) ? season.m : month
  const leafAll = leafiness(sm, south, true, env.lush)
  const counters: Partial<Record<Form, number>> = {}
  const twigN: Partial<Record<Form, number>> = {}
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
    // how much of this plant's crown is in leaf: each tree a little ahead of or behind its neighbours mid-season
    const L0 = sp.deciduous ? leafAll : 1
    const L = L0 > 0 && L0 < 1 ? Math.min(1, Math.max(0, L0 + (hash(i * 5 + 1) - 0.5) * 0.9 * L0 * (1 - L0))) : L0
    const cs = L < 0.04 ? 0 : 0.3 + 0.7 * Math.sqrt(L)
    // syntropic systems keep big canopies pruned; drawing them at full wild spread would hide everything below
    // The Codex's Target RS is the spacing at which a crop's crowns just meet, so a managed crown never needs to be
    // wider than that. `crown` (the slider) trims further, and a crown always leaves room for the nearest same-layer neighbour.
    // as neighbours are thinned out the survivors' crowns widen toward their natural spread and close the gap
    const natural = Math.min(sp.widthM, 3 + sp.widthM * 0.45)
    const managed = managedWidth(sp) + (natural - managedWidth(sp)) * crownRelease(sp, year)
    const w = Math.max(0.15, Math.min(managed * crown * g * cut, room[i]! * crown))
    const ci = (counters[f] = (counters[f] ?? -1) + 1)
    const cm = canopies[f]!
    canopyIds[f]![ci] = i
    // where the crown sits: as the tree ages it lifts up the trunk (up to ~22% of the height) and gets less deep
    const lifted = TRUNK_FRAC[f] > 0 && f !== 'palm' && f !== 'pollard'
    const y0 = lifted ? h * 0.22 * crownLift(g0) : 0
    const ch = h - y0
    crownW[i] = w
    crownY[i] = y0
    crownH[i] = ch
    if (g <= 0.001 || cs === 0) setInstance(cm, ci, p.x, -50, p.z, 0.001, 0.001, 0.001)
    else setInstance(cm, ci, p.x, y0 + ch * (1 - cs) * 0.25, p.z, w * cs, ch * (0.6 + 0.4 * cs), w * cs, rot[i])
    // bare branches: drawn while the crown is anything less than full, at the crown's full size
    const tm = twigs[f]
    if (tm && sp.deciduous) {
      const k = (twigN[f] = (twigN[f] ?? -1) + 1)
      if (g <= 0.001 || L > 0.97) setInstance(tm, k, p.x, -50, p.z, 0.001, 0.001, 0.001)
      else setInstance(tm, k, p.x, y0, p.z, w, ch, w, rot[i])
      if (colorPass) tm.setColorAt(k, bark.set(TWIG_BARK[i % TWIG_BARK.length]!).offsetHSL(0, 0, (hash(i + 9) - 0.5) * 0.06))
    }
    if (colorPass) {
      leafColour(sp.leaf, sp.deciduous, sm, south, env.lush, (i * 13 + p.s * 7) % 97, leaf)
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
      const bare = L < 0.5
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
  for (const f of TWIG_FORMS) {
    const m = twigs[f]
    if (!m) continue
    m.count = (twigN[f] ?? -1) + 1
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

// ── falling leaves ──
// In autumn a steady drift comes down from the deciduous crowns near you, and whenever the month moves on and the
// trees are dropping their leaves (the slider, ▶) it comes down thicker. Leaves land, lie a moment, and are recycled.
let spawnAcc = 0
let lastSeasonDraw = -1
let seasonPending = false
let nextSlot = 0
const fallC = new Color()
function spawnLeaf(sm: number, south: boolean, lush: boolean) {
  const d = current
  if (!d || !deciduous.length || !fall) return
  // a crown near the gardener, so the leaves fall where you're looking
  let i = deciduous[Math.floor(Math.random() * deciduous.length)]!
  for (let tries = 0; tries < 4; tries++) {
    const p = d.plants[i]!
    if (crownW[i]! > 0.3 && Math.hypot(p.x - player.x, p.z - player.z) < 55) break
    i = deciduous[Math.floor(Math.random() * deciduous.length)]!
  }
  if (crownW[i]! <= 0.3) return
  const p = d.plants[i]!
  let k = -1
  for (let n = 0; n < LEAVES; n++) {
    const j = (nextSlot + n) % LEAVES
    if (fy[j]! < 0) {
      k = j
      break
    }
  }
  if (k < 0) return
  nextSlot = (k + 1) % LEAVES
  const w = crownW[i]!
  fx[k] = p.x + (Math.random() - 0.5) * w * 0.8
  fz[k] = p.z + (Math.random() - 0.5) * w * 0.8
  fy[k] = crownY[i]! + crownH[i]! * (0.25 + Math.random() * 0.65)
  fvx[k] = (Math.random() - 0.5) * 0.5 + 0.25 // a light breeze from the west
  fvz[k] = (Math.random() - 0.5) * 0.5
  fspin[k] = Math.random() * Math.PI * 2
  frest[k] = 0
  const sp = d.species[p.s]!
  leafColour(sp.leaf, true, sm + 0.4, south, lush, (i * 13 + p.s * 7) % 97, fallC)
  fall.setColorAt(k, fallC.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1))
}
function dropLeaves(dt: number, elapsed: number) {
  if (!fall) return
  const env = s.env.value
  const south = (s.site.value?.lat ?? 0) < 0
  const sm = Number.isFinite(season.m) ? season.m : env.month
  const L = leafiness(sm, south, true, env.lush)
  const losing = Math.max(0, lastLeaf - L) / Math.max(dt, 1e-3) // share of the crown lost per second
  lastLeaf = L
  const autumn = !env.lush && L > 0.03 && L < 0.97 && leafiness(sm + 0.5, south, true, env.lush) < L // thinning toward winter
  spawnAcc += (autumn ? 30 : 0) * dt + Math.min(400, losing * 900) * dt
  while (spawnAcc >= 1) {
    spawnLeaf(sm, south, env.lush)
    spawnAcc--
  }
  const o = scratch.o
  for (let k = 0; k < LEAVES; k++) {
    if (fy[k]! < 0) {
      o.position.set(0, -50, 0)
      o.scale.setScalar(0.001)
    } else if (fy[k]! > 0.04) {
      // tumbling down, swaying side to side
      fy[k] = fy[k]! - dt * (0.55 + 0.25 * Math.sin(elapsed * 3 + k))
      fx[k] = fx[k]! + (fvx[k]! + Math.sin(elapsed * 1.7 + k * 1.3) * 0.6) * dt
      fz[k] = fz[k]! + (fvz[k]! + Math.cos(elapsed * 1.3 + k) * 0.4) * dt
      fspin[k] = fspin[k]! + dt * 3.2
      o.position.set(fx[k]!, fy[k]!, fz[k]!)
      o.rotation.set(fspin[k]!, fspin[k]! * 0.6 + k, Math.sin(fspin[k]!) * 0.8)
      o.scale.setScalar(1)
    } else {
      // on the ground: lie flat a few seconds, then fade into the litter
      frest[k] = frest[k]! + dt
      const left = 1 - frest[k]! / 4
      if (left <= 0) fy[k] = -1
      o.position.set(fx[k]!, 0.04, fz[k]!)
      o.rotation.set(-Math.PI / 2, 0, fspin[k]!)
      o.scale.setScalar(Math.max(0.001, left))
    }
    o.updateMatrix()
    fall.setMatrixAt(k, o.matrix)
  }
  fall.count = LEAVES
  fall.instanceMatrix.needsUpdate = true
  if (fall.instanceColor) fall.instanceColor.needsUpdate = true
}

if (import.meta.dev) (window as any).__leaves = () => ({ falling: [...fy].filter((y) => y > 0.04).length, onGround: [...fy].filter((y) => y >= 0 && y <= 0.04).length })

const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed, delta }) => {
  elapsedNow = elapsed
  // ease the month the trees show toward the month chosen (slider, ▶ or the live clock); redraw while it moves
  // big designs redraw at most ~12 times a second while the month glides, so the glide stays smooth
  if (stepSeason(s.env.value.month, elapsed, Math.min(delta, 0.1))) {
    const n = current?.plants.length ?? 0
    if (n < 3000 || elapsed - lastSeasonDraw > (n > 9000 ? 0.12 : 0.07)) {
      dirty = true
      lastSeasonDraw = elapsed
      seasonPending = false
    } else seasonPending = true
  } else if (seasonPending) {
    dirty = true // the glide ended on a skipped frame: draw where it landed
    seasonPending = false
  }
  dropLeaves(Math.min(delta, 0.05), elapsed)
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
