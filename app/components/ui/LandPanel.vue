<script setup lang="ts">
import { computed, ref } from 'vue'
import { fmtAreaShort } from '~/composables/useDesign'
import { polyAreaM2 } from '~/utils/geo'

// Step 1: stake out the land. Tap corners (no double-click needed), or bring a KML from Google Earth.
const d = useDesign()
const kmlIn = ref<HTMLInputElement | null>(null)
const drawing = computed(() => d.tool.value === 'boundary')
const sofar = computed(() => (d.drawPts.value.length >= 3 ? fmtAreaShort(polyAreaM2(d.drawPts.value), d.imperial.value) : ''))
function openKML(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) d.importKMLFile(f)
  ;(e.target as HTMLInputElement).value = ''
}
function undoCorner() {
  d.drawPts.value = d.drawPts.value.slice(0, -1)
}
</script>

<template>
  <div>
    <p class="step">Step 1 of 3</p>
    <h2>Stake out your land</h2>

    <template v-if="drawing">
      <p class="lede">Tap each corner on the map, going around. Tap the <b class="gold">first corner</b> again to close it.</p>
      <div class="picker-status">
        <span>{{ d.drawPts.value.length }} corner{{ d.drawPts.value.length === 1 ? '' : 's' }}<template v-if="sofar"> · {{ sofar }}</template></span>
        <button class="chip tiny" :disabled="!d.drawPts.value.length" @click="undoCorner">↶ Undo corner</button>
      </div>
      <div class="row gap-top">
        <button class="btn btn-primary grow" :disabled="d.drawPts.value.length < 3" @click="d.finishDraw()">✓ Close my land</button>
        <button v-if="d.plot.boundary.length" class="chip" @click="d.setTool('pan')">Cancel</button>
      </div>
    </template>

    <template v-else-if="d.plot.boundary.length >= 3">
      <p class="lede">Staked out: <b>{{ fmtAreaShort(d.areaM2.value, d.imperial.value) }}</b> · {{ d.plot.boundary.length }} corners</p>
      <button class="btn btn-primary wide" @click="d.step.value = 'rows'">Next: lay out rows →</button>
      <div class="row gap-top">
        <button class="chip" @click="d.setTool('boundary')">✎ Redraw</button>
        <button class="chip" @click="kmlIn?.click()">⬆ Import KML</button>
      </div>
    </template>

    <template v-else>
      <p class="lede">Your forest is drawn to the real size of your land, so start with its edges.</p>
      <button class="btn btn-primary wide" @click="d.setTool('boundary')">✎ Trace my land</button>
      <button class="btn wide gap-top" @click="kmlIn?.click()">⬆ I have a KML boundary</button>
      <p class="fine">From Google Earth: right-click your polygon → <i>Save Place As…</i> → KML.</p>
    </template>
    <input ref="kmlIn" type="file" accept=".kml,.xml" hidden @change="openKML">

    <!-- a KML with several polygons: pick the one that's the land -->
    <div v-if="d.ui.kml.length" class="kml-pick">
      <h3>Which one is your land?</h3>
      <button v-for="(p, i) in d.ui.kml" :key="i" class="option" @click="d.setBoundary(p.pts, p.name); d.ui.kml = []">
        <span class="goal-text"><b>{{ p.name }}</b><small>{{ p.pts.length }} corners · {{ fmtAreaShort(p.area, d.imperial.value) }}</small></span>
      </button>
      <button class="chip tiny" @click="d.ui.kml = []">Cancel</button>
    </div>
  </div>
</template>
