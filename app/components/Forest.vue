<script setup lang="ts">
const s = useDesign()
</script>

<template>
  <TresCanvas clear-color="#a8c8ff" :antialias="true" :dpr="[1, s.ui.mobile ? 1.5 : 2]">
    <World />
  </TresCanvas>
</template>
