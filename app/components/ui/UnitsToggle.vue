<script setup lang="ts">
// Metric or imperial, for every length, area, weight and temperature in the app. Remembered on this device.
const d = useDesign()
</script>

<template>
  <div class="units seg" role="group" aria-label="Units">
    <button class="chip tiny" :class="{ on: !d.imperial.value }" :aria-pressed="!d.imperial.value" title="Metres, hectares, kilograms, °C" @click="d.setUnits('metric')">m</button>
    <button class="chip tiny" :class="{ on: d.imperial.value }" :aria-pressed="d.imperial.value" title="Feet, acres, pounds, °F" @click="d.setUnits('imperial')">ft</button>
  </div>
</template>
