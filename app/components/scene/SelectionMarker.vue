<script setup lang="ts">
import { ref } from 'vue'

// A floating, turning gem and a glowing ring at the chosen plant.
const s = useDesign()
const player = usePlayer()
const gem = ref<any>(null)
const ring = ref<any>(null)
const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed }) => {
  const f = player.focus
  const on = s.selected.value !== null && !!f
  if (gem.value) {
    gem.value.visible = on
    if (on) {
      gem.value.position.set(f!.x, f!.h + 1.2 + Math.sin(elapsed * 3) * 0.2, f!.z)
      gem.value.rotation.y = elapsed * 1.6
    }
  }
  if (ring.value) {
    ring.value.visible = on
    if (on) {
      ring.value.position.set(f!.x, 0.09, f!.z)
      ring.value.scale.setScalar(Math.max(0.8, f!.h * 0.25) * (1 + Math.sin(elapsed * 4) * 0.06))
    }
  }
})
</script>

<template>
  <TresMesh ref="gem" :visible="false">
    <TresOctahedronGeometry :args="[0.35, 0]" />
    <TresMeshStandardMaterial color="#ffcf4a" emissive="#ffffff" :emissive-intensity="0.4" :flat-shading="true" />
  </TresMesh>
  <TresMesh ref="ring" :rotation="[-Math.PI / 2, 0, 0]" :visible="false">
    <TresRingGeometry :args="[1.1, 1.4, 36]" />
    <TresMeshBasicMaterial color="#fff3cf" :transparent="true" :opacity="0.85" :depth-write="false" />
  </TresMesh>
</template>
