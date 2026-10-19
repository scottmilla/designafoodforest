<script setup lang="ts">
import { computed, ref } from 'vue'
import { longestEdgeAngle } from '~/utils/geo'
import { fmtLen } from '~/utils/fmt'

// Step 2: the lines everything gets planted on. Straight rows redraw live as you move the sliders;
// contour rows are offset from a keyline you trace along the slope.
const d = useDesign()
const append = ref(false)
const includeBase = ref(true)
const shown = computed(() => Math.round(((d.plot.rowDir % 180) + 180) % 180))
const keylines = computed(() => d.plot.lines.filter((l) => !l.isOffset))
const PRESETS = [
  { m: 3, label: 'Market garden', sub: 'dense beds, hand work' },
  { m: 5, label: 'Food forest', sub: 'fruit + support, the classic' },
  { m: 8, label: 'Orchard alley', sub: 'room for a mower' },
  { m: 12, label: 'Tractor alley', sub: 'crops or pasture between' },
]
// compass bearing of the rows for people, from the map angle (0 = east, counter-clockwise)
const bearing = computed(() => {
  const b = (90 - shown.value + 360) % 180
  const names = ['N–S', 'NNE–SSW', 'NE–SW', 'ENE–WSW', 'E–W', 'ESE–WNW', 'SE–NW', 'SSE–NNW']
  return names[Math.round(b / 22.5) % 8]
})
</script>

<template>
  <div>
    <p class="step">Step 2 of 3</p>
    <h2>Lay out your rows</h2>
    <div class="seg">
      <button class="chip" :class="{ on: d.rowMode.value === 'straight' }" @click="d.setRowMode('straight')">▤ Straight</button>
      <button class="chip" :class="{ on: d.rowMode.value === 'keyline' }" @click="d.setRowMode('keyline')">〰 Follow the slope</button>
    </div>

    <h3>Row spacing · <b>{{ d.plot.rowSpacing }} m</b> <small v-if="d.imperial.value">({{ fmtLen(d.plot.rowSpacing, true) }})</small></h3>
    <input :value="d.plot.rowSpacing" type="range" min="1" max="20" step="0.5" class="range" aria-label="Row spacing" @input="d.setRowSpacing(+($event.target as HTMLInputElement).value)">
    <div class="presets">
      <button v-for="p in PRESETS" :key="p.m" class="chip tiny" :class="{ on: d.plot.rowSpacing === p.m }" :title="p.sub" @click="d.setRowSpacing(p.m)">{{ p.m }} m · {{ p.label }}</button>
    </div>

    <template v-if="d.rowMode.value === 'straight'">
      <h3>Direction · <b>{{ shown }}°</b> <small>(rows run {{ bearing }})</small></h3>
      <input :value="shown" type="range" min="0" max="180" step="1" class="range" aria-label="Row direction" @input="d.setRowDir(+($event.target as HTMLInputElement).value)">
      <div class="presets">
        <button class="chip tiny" title="North–south rows light both sides of every row through the day" @click="d.setRowDir(90)">☀ North–south</button>
        <button class="chip tiny" @click="d.setRowDir(longestEdgeAngle(d.plot.boundary))">↔ Longest edge</button>
        <button class="chip tiny" :class="{ on: d.tool.value === 'orient' }" @click="d.setTool(d.tool.value === 'orient' ? 'pan' : 'orient')">📐 Tap two points</button>
      </div>
      <p v-if="d.tool.value === 'orient'" class="fine">Tap two points on the map along the line you want the rows to follow.</p>
    </template>

    <template v-else>
      <div class="ksteps">
        <div class="kstep" :class="{ done: keylines.length }">
          <i>{{ keylines.length ? '✓' : '1' }}</i>
          <div>
            <b>Trace a keyline</b> along the contour of your slope, tapping points as you go.
            <div class="presets">
              <button class="chip tiny" :class="{ on: d.tool.value === 'keyline' }" @click="d.setTool(d.tool.value === 'keyline' ? 'pan' : 'keyline')">{{ d.tool.value === 'keyline' ? 'Tracing… tap points' : keylines.length ? '✎ Trace another' : '✎ Trace' }}</button>
              <button v-if="d.tool.value === 'keyline'" class="chip tiny on" :disabled="d.drawPts.value.length < 2" @click="d.finishDraw()">✓ Done</button>
            </div>
          </div>
        </div>
        <div class="kstep">
          <i>2</i>
          <div>
            <b>Fill the land</b> with rows offset from it every {{ d.plot.rowSpacing }} m.
            <button class="btn btn-primary wide gap-top" :disabled="!keylines.length" @click="d.fillFromKeyline({ append, includeBase })">〰 Fill from keyline</button>
          </div>
        </div>
      </div>
      <details class="more">
        <summary>More keyline tools</summary>
        <label class="optin"><input v-model="includeBase" type="checkbox"> Plant on the keyline itself</label>
        <label class="optin"><input v-model="append" type="checkbox"> Add to existing rows (don't replace)</label>
        <div class="presets">
          <button class="chip tiny" :class="{ on: d.tool.value === 'zone' }" @click="d.setTool(d.tool.value === 'zone' ? 'pan' : 'zone')">▱ Fill only a zone</button>
          <button v-if="d.tool.value === 'zone'" class="chip tiny on" :disabled="d.drawPts.value.length < 3" @click="d.finishDraw()">✓ Close zone</button>
          <button v-if="d.plot.fillZone.length" class="chip tiny" @click="d.plot.fillZone = []; d.changed()">Clear zone</button>
          <button v-if="d.plot.lines.length" class="chip tiny" @click="d.clearKeylines()">Clear keylines</button>
        </div>
        <p class="fine">Several slopes? Draw a zone and a keyline for each, then fill with “add to existing rows” on.</p>
      </details>
    </template>

    <div class="picker-status">
      <span>{{ d.plot.rows.length }} rows · {{ Math.round(d.rowMetres.value).toLocaleString() }} m of planting line</span>
    </div>
    <p v-if="d.plot.plants.length" class="fine">Your {{ d.plot.plants.length.toLocaleString() }} plants stay where they are when rows move. Undo with ↩.</p>
    <button class="btn btn-primary wide gap-top" :disabled="!d.plot.rows.length" @click="d.step.value = 'plant'; d.setTool(d.selSpId.value ? 'place' : 'pan')">Next: plant →</button>
  </div>
</template>
