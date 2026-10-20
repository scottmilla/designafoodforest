<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { Color, Group, type InstancedMesh } from 'three'
import type { Form } from '#shared/types'
import { canopyGeometry, hash, leafColour, leafiness, makeInstanced, rng, setInstance, swayMaterial, trunkGeometry, TRUNK_FRAC, TWIG_BARK, TWIG_FORMS, twigGeometry } from '~/utils/plantGeo'
import { stepSeason, useSeason } from '~/composables/useSeason'

// A nondescript wild forest around the clearing, dressed for the person's climate and the month: its deciduous
// trees go bare in winter and leaf out in spring, like the design's (the month is eased; see useSeason).
const s = useDesign()
const group = new Group()
const leafMat = swayMaterial({ color: '#ffffff', roughness: 0.8 }, 0.8)
const trunkMat = swayMaterial({ color: '#ffffff', roughness: 0.9 }, 0.1)
const trunkGeo = trunkGeometry()
const geoCache: Partial<Record<Form, ReturnType<typeof canopyGeometry>>> = {}
const twigCache: Partial<Record<Form, ReturnType<typeof twigGeometry>>> = {}
const twigMat = swayMaterial({ color: '#ffffff', roughness: 0.95 }, 0.4)
const season = useSeason()
let meshes: InstancedMesh[] = []
// what dress() needs to redraw the crowns for a new month
type Pt = { k: Kind; x: number; z: number; h: number; w: number; seed: number; far: number }
let dressList: { form: Form; list: Pt[]; leaves: InstancedMesh; twigs: InstancedMesh | null }[] = []

interface Kind { form: Form; leaf: string; h: [number, number]; w: [number, number]; dec: boolean; weight: number }

function palette(): Kind[] {
  const site = s.site.value
  const z = site?.zone ?? 7
  const c = site?.climate
  if (!site) return [{ form: 'round', leaf: '#5aa64a', h: [7, 12], w: [5, 8], dec: true, weight: 3 }, { form: 'columnar', leaf: '#4f9446', h: [9, 15], w: [4, 6], dec: true, weight: 2 }, { form: 'conifer', leaf: '#2f6a46', h: [10, 16], w: [4, 6], dec: false, weight: 1 }]
  if (c === 'tropical' || z >= 10.5)
    return [
      { form: 'spreading', leaf: '#3a8a3a', h: [12, 22], w: [10, 16], dec: false, weight: 3 },
      { form: 'round', leaf: '#2f7a3a', h: [8, 14], w: [6, 9], dec: false, weight: 3 },
      { form: 'palm', leaf: '#5aa04a', h: [8, 15], w: [5, 7], dec: false, weight: 2 },
      { form: 'columnar', leaf: '#4a9a3a', h: [14, 20], w: [5, 8], dec: false, weight: 1 },
    ]
  if (c === 'arid')
    return [
      { form: 'spreading', leaf: '#9aaa6a', h: [4, 7], w: [5, 8], dec: false, weight: 2 },
      { form: 'shrub', leaf: '#a8b07a', h: [1.5, 3], w: [2, 3], dec: false, weight: 3 },
      { form: 'conifer', leaf: '#5a7a5a', h: [5, 8], w: [3, 5], dec: false, weight: 1 },
    ]
  if (c === 'mediterranean' || c === 'subtropical')
    return [
      { form: 'spreading', leaf: '#5a7a4a', h: [8, 14], w: [8, 12], dec: false, weight: 3 },
      { form: 'round', leaf: '#6a8a5a', h: [6, 10], w: [5, 8], dec: false, weight: 2 },
      { form: 'conifer', leaf: '#3a6a4a', h: [12, 18], w: [4, 6], dec: false, weight: 1 },
      { form: 'palm', leaf: '#7a9a5a', h: [6, 10], w: [4, 6], dec: false, weight: z >= 9 ? 1 : 0 },
    ]
  if (c === 'cold')
    return [
      { form: 'conifer', leaf: '#2f5a46', h: [12, 20], w: [4, 6], dec: false, weight: 4 },
      { form: 'columnar', leaf: '#7aaa5a', h: [10, 16], w: [3, 5], dec: true, weight: 2 },
      { form: 'round', leaf: '#5a9a4a', h: [8, 12], w: [5, 8], dec: true, weight: 1 },
    ]
  return [
    { form: 'round', leaf: '#4f9a46', h: [12, 20], w: [8, 12], dec: true, weight: 4 },
    { form: 'columnar', leaf: '#6aaa4f', h: [16, 24], w: [6, 9], dec: true, weight: 2 },
    { form: 'spreading', leaf: '#3f8a3e', h: [14, 20], w: [10, 14], dec: true, weight: 2 },
    { form: 'conifer', leaf: '#2f6a4a', h: [14, 22], w: [5, 7], dec: false, weight: 1 },
  ]
}

function build() {
  for (const m of meshes) { group.remove(m); m.dispose() }
  meshes = []
  const kinds = palette().filter((k) => k.weight > 0)
  const total = kinds.reduce((a, k) => a + k.weight, 0)
  const plot = s.stage.value === 'forest' ? s.scene.value : null
  const hw = (plot?.width ?? 0) / 2 + 12
  const hd = (plot?.depth ?? 0) / 2 + 12
  const clearR = plot ? 0 : 22
  const inner = Math.max(Math.hypot(hw, hd) * 0.85, 22)
  const outer = inner + 46
  const r = rng(Math.round((s.site.value?.lat ?? 1) * 1000) + 7)
  const n = Math.min(2200, Math.round((Math.PI * (outer * outer - inner * inner)) / 32))
  const pts: Pt[] = []
  for (let i = 0; i < n * 1.6 && pts.length < n; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(inner * inner + r() * (outer * outer - inner * inner))
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (Math.abs(x) < hw && Math.abs(z) < hd) continue
    if (Math.hypot(x, z) < clearR) continue
    // keep a gap open in front of the spawn point so the view south isn't a wall of trunks
    if (z > hd && Math.abs(x) < 7 && z < hd + 26) continue
    let pick = r() * total
    const k = kinds.find((kk) => (pick -= kk.weight) < 0) ?? kinds[0]!
    pts.push({ k, x, z, h: k.h[0] + r() * (k.h[1] - k.h[0]), w: k.w[0] + r() * (k.w[1] - k.w[0]), seed: i, far: Math.min(1, (Math.hypot(x, z) - inner) / (outer - inner)) })
  }
  const byForm = new Map<Form, typeof pts>()
  for (const p of pts) byForm.set(p.k.form, [...(byForm.get(p.k.form) ?? []), p])
  const trunks = makeInstanced(trunkGeo, trunkMat, pts.length)
  let ti = 0
  const c = new Color()
  dressList = []
  for (const [form, list] of byForm) {
    const m = makeInstanced((geoCache[form] ??= canopyGeometry(form)), leafMat, list.length)
    const dec = list.some((p) => p.k.dec) && TWIG_FORMS.includes(form)
    const tw = dec ? makeInstanced((twigCache[form] ??= twigGeometry(form)), twigMat, list.length) : null
    dressList.push({ form, list, leaves: m, twigs: tw })
    list.forEach((p) => {
      if (TRUNK_FRAC[form] > 0) {
        setInstance(trunks, ti, p.x, 0, p.z, 0.25 + p.h * 0.03, p.h * TRUNK_FRAC[form], 0.25 + p.h * 0.03)
        trunks.setColorAt(ti++, c.set('#6f4a33'))
      }
    })
    group.add(m)
    meshes.push(m)
    if (tw) {
      group.add(tw)
      meshes.push(tw)
    }
  }
  dress()
  trunks.count = ti
  trunks.instanceMatrix.needsUpdate = true
  group.add(trunks)
  meshes.push(trunks)
}

// the crowns for the month the scene is showing: leaf amount and colour, bare twigs where the leaves are gone
const far = new Color('#8fa6c9')
function dress() {
  const env = s.env.value
  const south = (s.site.value?.lat ?? 0) < 0
  const sm = Number.isFinite(season.m) ? season.m : env.month
  const all = leafiness(sm, south, true, env.lush)
  const c = new Color()
  for (const { list, leaves, twigs } of dressList) {
    list.forEach((p, i) => {
      const L0 = p.k.dec ? all : 1
      const L = L0 > 0 && L0 < 1 ? Math.min(1, Math.max(0, L0 + (hash(p.seed * 5 + 1) - 0.5) * 0.9 * L0 * (1 - L0))) : L0
      const cs = L < 0.04 ? 0 : 0.3 + 0.7 * Math.sqrt(L)
      if (cs === 0) setInstance(leaves, i, p.x, -50, p.z, 0.001, 0.001, 0.001)
      else setInstance(leaves, i, p.x, p.h * (1 - cs) * 0.25, p.z, p.w * cs, p.h * (0.6 + 0.4 * cs), p.w * cs, p.seed)
      // aerial perspective: distant trees cool toward blue-violet, as in a lasur painting
      leafColour(p.k.leaf, p.k.dec, sm, south, env.lush, p.seed, c).lerp(far, p.far * 0.35)
      leaves.setColorAt(i, c)
      if (twigs) {
        if (!p.k.dec || L > 0.97) setInstance(twigs, i, p.x, -50, p.z, 0.001, 0.001, 0.001)
        else setInstance(twigs, i, p.x, 0, p.z, p.w, p.h, p.w, p.seed)
        twigs.setColorAt(i, c.set(TWIG_BARK[p.seed % TWIG_BARK.length]!).lerp(far, p.far * 0.35))
      }
    })
    for (const m of [leaves, twigs]) {
      if (!m) continue
      m.count = list.length
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }
}

watch([() => (s.stage.value === 'forest' ? s.scene.value.width : 0), () => s.site.value?.label, () => s.env.value.lush], build, { immediate: true })
const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed, delta }) => {
  if (stepSeason(s.env.value.month, elapsed, Math.min(delta, 0.1))) dress()
})
onBeforeUnmount(() => meshes.forEach((m) => m.dispose()))
</script>

<template>
  <primitive :object="group" />
</template>
