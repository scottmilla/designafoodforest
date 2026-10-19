<script setup lang="ts">
import { onBeforeUnmount, ref, unref, watch } from 'vue'
import { BufferGeometry, Color, Float32BufferAttribute, Points, PointsMaterial, type Fog } from 'three'
import { rng } from '~/utils/plantGeo'

// Light, fog, drifting clouds and precipitation, all following today's real weather at the site.
const s = useDesign()
const player = usePlayer()
const { scene } = useTres()

const hemi = ref<any>(null)
const sun = ref<any>(null)
const fogColor = new Color()
const dayFog = new Color('#e6d8ea')
const nightFog = new Color('#2a2448')
const duskFog = new Color('#f2b8a0')
const greyFog = new Color('#c8c6d2')

// precipitation: one Points cloud that follows the player
const N = 2200
const geo = new BufferGeometry()
const pos = new Float32Array(N * 3)
const r = rng(99)
for (let i = 0; i < N; i++) {
  pos[i * 3] = (r() - 0.5) * 60
  pos[i * 3 + 1] = r() * 30
  pos[i * 3 + 2] = (r() - 0.5) * 60
}
geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
const precipMat = new PointsMaterial({ color: '#cfe0ff', size: 0.12, transparent: true, opacity: 0.8, depthWrite: false })
const precip = new Points(geo, precipMat)
precip.frustumCulled = false
precip.visible = false

const clouds = ref<any[]>([])
const cloudDefs = Array.from({ length: 14 }, (_, i) => ({
  x: -120 + i * 18 + (i % 2) * 6, y: 46 + (i % 3) * 6, z: -60 - ((i * 23) % 80) + (i % 4) * 40, s: 1.4 + (i % 4) * 0.35, speed: 0.6 + (i % 3) * 0.2, need: i / 14,
}))

watch(() => s.env.value.snow, (snow) => {
  precipMat.size = snow ? 0.28 : 0.12
  precipMat.color.set(snow ? '#ffffff' : '#bcd3ff')
}, { immediate: true })

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const e = s.env.value
  const k = Math.min(1, delta * 1.5)
  const sc = unref(scene)
  const fog = sc.fog as Fog | null
  fogColor.copy(dayFog).lerp(duskFog, e.dusk * 0.5).lerp(greyFog, e.overcast * 0.6).lerp(nightFog, 1 - e.day)
  if (fog) {
    fog.color.lerp(fogColor, k)
    const span = s.stage.value === "forest" ? Math.max(s.scene.value.width, s.scene.value.depth, 40) : 40
    fog.near = (e.fog ? 15 : 40) + span * 0.4
    fog.far = (e.fog ? 90 : 160) + span * 1.2
  }
  if (hemi.value) hemi.value.intensity += (0.45 + e.day * 0.75 - e.overcast * 0.1 - hemi.value.intensity) * k
  if (sun.value) {
    const target = (0.25 + e.day * 2.0) * (1 - e.overcast * 0.45)
    sun.value.intensity += (target - sun.value.intensity) * k
    const el = e.day > 0.05 ? e.sunElev : 0.9 // at night this is moonlight from high up
    sun.value.position.set(Math.sin(e.sunAz) * Math.cos(el) * 60 + player.x, Math.sin(el) * 60, Math.cos(e.sunAz) * Math.cos(el) * 60 + player.z)
    sun.value.color.set(e.day < 0.1 ? '#a9b6ff' : e.dusk > 0.4 ? '#ffc08a' : '#fff3d6')
  }
  precip.visible = e.rain > 0 || e.snow > 0
  if (precip.visible) {
    const a = geo.attributes.position!.array as Float32Array
    const fall = (e.snow ? 2.2 : 22) * delta
    for (let i = 0; i < N; i++) {
      a[i * 3 + 1]! -= fall * (0.7 + (i % 5) * 0.1)
      if (e.snow) a[i * 3]! += Math.sin(elapsed + i) * delta * 0.6
      if (a[i * 3 + 1]! < 0) a[i * 3 + 1] = 30
    }
    geo.attributes.position!.needsUpdate = true
    precip.position.set(player.x, 0, player.z)
  }
  // over a big farm the bird's-eye camera climbs high: lift the clouds above it
  const lift = s.stage.value === 'forest' ? Math.max(0, Math.max(s.scene.value.width, s.scene.value.depth) * 0.75 - 20) : 0
  clouds.value.forEach((g, i) => {
    if (!g) return
    const d = cloudDefs[i]!
    g.position.y = d.y + lift
    g.visible = d.need < 0.25 + e.overcast * 0.85
    g.position.x += d.speed * delta
    if (g.position.x > 140) g.position.x = -140
  })
})
onBeforeUnmount(() => {
  geo.dispose()
  precipMat.dispose()
})
</script>

<template>
  <TresFog :args="['#e6d8ea', 60, 220]" attach="fog" />
  <TresHemisphereLight ref="hemi" :args="['#fff4e6', '#9fd68a', 1.1]" />
  <TresDirectionalLight ref="sun" :position="[20, 40, 30]" :intensity="2.2" color="#fff3d6" />
  <primitive :object="precip" />
  <TresGroup v-for="(c, i) in cloudDefs" :key="i" :ref="(el: any) => (clouds[i] = el)" :position="[c.x, c.y, c.z]" :scale="c.s">
    <TresMesh v-for="(b, j) in [[0, 0, 0, 3], [3, -0.5, 0.3, 2.3], [-3, -0.6, -0.2, 2.1], [1, 1.2, 0, 2.2]]" :key="j" :position="[b[0]!, b[1]!, b[2]!]">
      <TresIcosahedronGeometry :args="[b[3]!, 1]" />
      <TresMeshStandardMaterial :color="s.env.value.overcast > 0.6 ? '#dcdbe6' : '#ffffff'" :flat-shading="true" :fog="false" />
    </TresMesh>
  </TresGroup>
</template>
