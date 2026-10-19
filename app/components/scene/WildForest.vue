<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { Color, Group, type InstancedMesh } from 'three'
import type { Form } from '#shared/types'
import { canopyGeometry, canopyScaleFor, makeInstanced, rng, seasonalLeaf, setInstance, swayMaterial, trunkGeometry, TRUNK_FRAC } from '~/utils/plantGeo'

// A nondescript wild forest around the clearing, dressed for the person's climate and season.
const s = useDesign()
const group = new Group()
const leafMat = swayMaterial({ color: '#ffffff', roughness: 0.8 }, 0.8)
const trunkMat = swayMaterial({ color: '#ffffff', roughness: 0.9 }, 0.1)
const trunkGeo = trunkGeometry()
const geoCache: Partial<Record<Form, ReturnType<typeof canopyGeometry>>> = {}
let meshes: InstancedMesh[] = []

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
  const env = s.env.value
  const r = rng(Math.round((s.site.value?.lat ?? 1) * 1000) + 7)
  const n = Math.min(2200, Math.round((Math.PI * (outer * outer - inner * inner)) / 32))
  const pts: { k: Kind; x: number; z: number; h: number; w: number; seed: number }[] = []
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
    pts.push({ k, x, z, h: k.h[0] + r() * (k.h[1] - k.h[0]), w: k.w[0] + r() * (k.w[1] - k.w[0]), seed: i })
  }
  const byForm = new Map<Form, typeof pts>()
  for (const p of pts) byForm.set(p.k.form, [...(byForm.get(p.k.form) ?? []), p])
  const trunks = makeInstanced(trunkGeo, trunkMat, pts.length)
  let ti = 0
  const c = new Color()
  for (const [form, list] of byForm) {
    const m = makeInstanced((geoCache[form] ??= canopyGeometry(form)), leafMat, list.length)
    list.forEach((p, i) => {
      const cs = canopyScaleFor(p.k.dec, env.season, env.lush)
      setInstance(m, i, p.x, 0, p.z, p.w * cs, p.h, p.w * cs, p.seed)
      seasonalLeaf(p.k.leaf, p.k.dec, env.season, env.lush, p.seed, c)
      // aerial perspective: distant trees cool toward blue-violet, as in a lasur painting
      const far = Math.min(1, (Math.hypot(p.x, p.z) - inner) / (outer - inner))
      c.lerp(new Color('#8fa6c9'), far * 0.35)
      m.setColorAt(i, c)
      if (TRUNK_FRAC[form] > 0) {
        setInstance(trunks, ti, p.x, 0, p.z, 0.25 + p.h * 0.03, p.h * TRUNK_FRAC[form], 0.25 + p.h * 0.03)
        trunks.setColorAt(ti++, c.set('#6f4a33'))
      }
    })
    m.count = list.length
    m.instanceMatrix.needsUpdate = true
    group.add(m)
    meshes.push(m)
  }
  trunks.count = ti
  trunks.instanceMatrix.needsUpdate = true
  group.add(trunks)
  meshes.push(trunks)
}

watch([() => (s.stage.value === 'forest' ? s.scene.value.width : 0), () => s.site.value?.label, () => s.env.value.season, () => s.env.value.lush], build, { immediate: true })
onBeforeUnmount(() => meshes.forEach((m) => m.dispose()))
</script>

<template>
  <primitive :object="group" />
</template>
