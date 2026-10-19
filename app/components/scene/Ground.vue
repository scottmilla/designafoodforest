<script setup lang="ts">
import { computed } from 'vue'
import { Color } from 'three'
import { rng } from '~/utils/plantGeo'

// Colour as living experience: the meadow is painted in translucent glazes (Steiner's lasur technique),
// warm and advancing near you, cooling toward blue-green in the distance, and re-dyed by climate and season.
const s = useDesign()

const tones = computed(() => {
  const e = s.env.value
  const snowy = e.snow > 0 || (e.season === 'winter' && (s.weather.value?.tempC ?? 5) < -1)
  if (snowy) return ['#eef1f6', '#c9d4e6']
  if (e.lush) return ['#8fd65a', '#3fae8a']
  if (e.arid) return ['#dcc68a', '#b9a46e']
  return { spring: ['#b4e46a', '#5cc59a'], summer: ['#a6dc58', '#58bfa4'], autumn: ['#cfc65a', '#8fae7a'], winter: ['#b9c49a', '#93b0a8'] }[e.season]
})

// the meadow grows with the land so its edge never shows, even around a big farm
const k = computed(() => (s.stage.value === 'forest' ? Math.max(1, (Math.max(s.scene.value.width, s.scene.value.depth) + 260) / 280) : 1))

const N = 10
const strips = computed(() => {
  const [a, b] = tones.value as [string, string]
  return Array.from({ length: N }, (_, i) => ({
    z: 140 - (280 / N) * (i + 0.5),
    len: 280 / N + 0.05,
    color: '#' + new Color(a).lerp(new Color(b), Math.abs(i - N * 0.62) / N).getHexString(),
  }))
})

const washColors = computed(() => (s.env.value.lush ? ['#d6f06a', '#6fe0a0', '#7fb0e0', '#b79adf', '#ffcf7a'] : s.env.value.season === 'autumn' ? ['#ffcf6a', '#ff9f6a', '#b79adf', '#d6c06a', '#8fb0d0'] : ['#ffe27a', '#8fe39a', '#7fb0e0', '#b79adf', '#ff9f7a', '#d6f06a']))
const wr = rng(2024)
const washes = Array.from({ length: 46 }, (_, i) => ({
  x: (wr() - 0.5) * 220, z: (wr() - 0.5) * 220, r: 3 + wr() * 6, stretch: 1.3 + wr() * 1.2, rot: wr() * 3, i, o: 0.12 + wr() * 0.14, y: 0.004 + (i % 6) * 0.002,
}))
</script>

<template>
  <TresGroup :scale="[k, 1, k]">
  <TresMesh v-for="(st, i) in strips" :key="i" :rotation="[-Math.PI / 2, 0, 0]" :position="[0, 0, st.z]">
    <TresPlaneGeometry :args="[320, st.len]" />
    <TresMeshStandardMaterial :color="st.color" />
  </TresMesh>
  <TresMesh v-for="w in washes" :key="'w' + w.i" :rotation="[-Math.PI / 2, 0, w.rot]" :position="[w.x, w.y, w.z]" :scale="[1, w.stretch, 1]">
    <TresCircleGeometry :args="[w.r, 24]" />
    <TresMeshBasicMaterial :color="washColors[w.i % washColors.length]" :transparent="true" :opacity="w.o * (s.env.value.day * 0.7 + 0.3)" :depth-write="false" />
  </TresMesh>
  </TresGroup>
</template>
