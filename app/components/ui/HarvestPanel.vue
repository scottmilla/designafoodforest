<script setup lang="ts">
// In the forest view there's no side card to flip, so harvest floats in the left column instead.
const d = useDesign()
</script>

<template>
  <Transition name="slide-r">
    <aside v-if="d.ui.harvest" class="system harvest card">
      <HarvestBody @close="d.ui.harvest = false" />
    </aside>
  </Transition>
</template>
