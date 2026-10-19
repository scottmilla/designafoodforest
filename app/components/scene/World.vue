<script setup lang="ts">
import { swayUniforms } from '~/utils/plantGeo'

// The painted world: today's real sky at the site, a meadow, a wild forest ring and, once we're in the
// forest, the land itself with your design growing on it.
const s = useDesign()
const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed }) => {
  swayUniforms.uTime.value = elapsed
})
</script>

<template>
  <Atmosphere />
  <SkyDome />
  <Ground />
  <WildForest />
  <template v-if="s.stage.value === 'forest'">
    <SatGround />
    <Plot />
    <FarmPlants />
    <SelectionMarker />
    <GroundTap />
  </template>
  <Player />
  <CameraRig />
</template>
