<script setup lang="ts">
import { ref } from 'vue'
import { fmtAreaShort, type SavedDesign } from '~/composables/useDesign'
import { polyAreaM2 } from '~/utils/geo'

// The title: the painted forest behind, one question in front.
const d = useDesign()
const file = ref<HTMLInputElement | null>(null)
function openFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) d.importJSONFile(f)
  ;(e.target as HTMLInputElement).value = ''
}
// a saved design's totals over all its plots (the active plot is stored as `plot`)
const others = (sv: SavedDesign) => (sv.plots ?? []).filter((p) => p.id !== sv.activePlotId)
const plantsIn = (sv: SavedDesign) => sv.plot.plants.length + others(sv).reduce((a, p) => a + p.data.plants.length, 0)
const areaOf = (sv: SavedDesign) => polyAreaM2(sv.plot.boundary) + others(sv).reduce((a, p) => a + polyAreaM2(p.data.boundary), 0)
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
</script>

<template>
  <div class="title">
    <p class="eyebrow">✦ a syntropic food forest, drawn on your own land ✦</p>
    <h1>Design a Food Forest</h1>
    <div class="card survey-card q1">
      <h2>Where is your land?</h2>
      <p class="lede">Type the address. We'll fly down onto it, read ten years of its sky, and hand you the tools to plant it.</p>
      <AddressSearch big autofocus />
      <p class="fine">Pick from the suggestions as you type. An address, a town, a farm name, or coordinates like <i>-36.647, 174.639</i>.</p>

      <template v-if="d.saves.value.length">
        <h3>Your designs</h3>
        <ul class="saved">
          <li v-for="sv in d.saves.value.slice(0, 5)" :key="sv.id">
            <button type="button" class="open" @click="d.openSave(sv.id)">
              <b>{{ sv.name }}</b>
              <small>{{ plantsIn(sv).toLocaleString() }} plants · {{ fmtAreaShort(areaOf(sv), d.imperial.value) }}<template v-if="(sv.plots?.length ?? 1) > 1"> · {{ sv.plots!.length }} plots</template> · {{ ago(sv.savedAt) }}</small>
            </button>
          </li>
        </ul>
      </template>
      <button type="button" class="linkish" @click="file?.click()">📂 Open a design file (JSON from here or the Syntropic Designer)</button>
      <input ref="file" type="file" accept=".json" hidden @change="openFile">
    </div>
  </div>
</template>
