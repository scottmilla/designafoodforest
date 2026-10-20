<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const d = useDesign()
const emit = defineEmits<{ dive: []; fit: [] }>()
const jsonIn = ref<HTMLInputElement | null>(null)
// a click anywhere outside the tools row closes the menu
const away = (e: PointerEvent) => {
  if (d.ui.menu && !(e.target as HTMLElement).closest('.tools')) d.ui.menu = false
}
onMounted(() => window.addEventListener('pointerdown', away))
onBeforeUnmount(() => window.removeEventListener('pointerdown', away))

const climateName = computed(() => ({ tropical: 'Tropical', subtropical: 'Subtropical', mediterranean: 'Mediterranean', arid: 'Arid', temperate: 'Temperate', cold: 'Cold temperate' })[d.site.value?.climate ?? 'temperate'])
function openJSON(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) d.importJSONFile(f)
  ;(e.target as HTMLInputElement).value = ''
  d.ui.menu = false
}
function startOver() {
  d.saveNow()
  d.stage.value = 'intro'
  d.ui.menu = false
}
</script>

<template>
  <div class="hud">
    <!-- where, and what the sky does there -->
    <div class="hud-left">
      <section class="climate" :class="{ compact: d.ui.mobile }">
      <p class="place">📍 {{ d.geo.value?.label }}</p>
      <p v-if="d.geo.value?.place && d.geo.value.place !== d.geo.value.label" class="where">{{ d.geo.value.place }}</p>
      <p v-if="d.site.value" class="zone"><b>Zone {{ d.site.value.zoneLabel }}</b> · {{ climateName }}<small v-if="d.site.value.estimated"> (est.)</small></p>
      <p v-else-if="d.climateLoading.value" class="meta busy">🌦 reading ten years of your sky…</p>
      <details v-if="d.alternatives.value.length && !d.plot.boundary.length" class="alts">
        <summary>Not your land? {{ d.alternatives.value.length }} other match{{ d.alternatives.value.length > 1 ? 'es' : '' }}</summary>
        <button v-for="(a, i) in d.alternatives.value" :key="i" class="option" @click="d.relocate(a); d.alternatives.value = d.alternatives.value.filter((x) => x !== a)">📍 {{ a.full }}</button>
      </details>
      <p v-if="d.site.value" class="meta hide-compact">{{ d.imperial.value ? Math.round(d.site.value.precipMm / 25.4) + ' in' : d.site.value.precipMm + ' mm' }} rain · {{ d.site.value.frostFreeDays }} frost-free days · {{ d.site.value.chillHours }} chill h</p>
    </section>
    </div>

    <!-- tools -->
    <div class="tools">
      <div class="row">
        <button class="chip" :disabled="!d.histState.canUndo" aria-label="Undo" title="Undo (⌘Z)" @click="d.undo()">↩</button>
        <button class="chip" :disabled="!d.histState.canRedo" aria-label="Redo" title="Redo (⇧⌘Z)" @click="d.redo()">↪</button>
        <button class="chip" :class="{ on: d.ui.harvest }" @click="d.ui.harvest = !d.ui.harvest">📊<span class="hide-compact"> Harvest</span></button>
        <UnitsToggle />
        <button class="chip" :class="{ on: d.ui.menu }" aria-label="Menu" @click="d.ui.menu = !d.ui.menu">☰</button>
      </div>
      <Transition name="pop">
        <div v-if="d.ui.menu" class="menu card">
          <label class="menu-name">
            <small>Design name</small>
            <input v-model="d.name.value" class="field" @change="d.saveNow()">
          </label>
          <div class="menu-name">
            <small>Go to an address</small>
            <AddressSearch placeholder="Another address, or lat, lng" button="Go" />
          </div>
          <button class="option" @click="d.ui.labels = !d.ui.labels">🏷 {{ d.ui.labels ? 'Hide' : 'Show' }} plant names</button>
          <label class="option sat">🛰 Photo <input v-model.number="d.ui.sat" type="range" min="0.15" max="1" step="0.05" aria-label="Satellite photo strength"></label>
          <button v-if="d.plot.boundary.length >= 3" class="option" @click="emit('fit'); d.ui.menu = false">🔍 Fit my land on screen</button>
          <hr>
          <button class="option" @click="d.exportKML(); d.ui.menu = false">⬇ Export KML <small>(Google Earth{{ d.plots.value.length > 1 ? ', this plot' : '' }})</small></button>
          <button class="option" @click="d.exportJSON(); d.ui.menu = false">⬇ Save design file <small>(JSON{{ d.plots.value.length > 1 ? ', all plots' : '' }})</small></button>
          <button class="option" @click="d.exportPlotJSON(); d.ui.menu = false">⬇ Save this plot only <small>(Plot JSON)</small></button>
          <button class="option" @click="jsonIn?.click()">📂 Open a file <small>(a plot file is added as a plot)</small></button>
          <button class="option" @click="startOver">✦ New address / my designs</button>
          <input ref="jsonIn" type="file" accept=".json" hidden @change="openJSON">
          <p class="fine">Saved automatically on this device.</p>
        </div>
      </Transition>
    </div>

    <!-- step inside -->
    <div class="bottom">
      <span />
      <button class="btn btn-primary cta" :title="'Or just keep zooming in'" @click="emit('dive')">🌳 Step inside</button>
    </div>

    <Transition name="toast"><div v-if="d.toast.value" class="toast">{{ d.toast.value }}</div></Transition>
  </div>
</template>
