<script setup lang="ts">
import { fmtAreaShort, type Step } from '~/composables/useDesign'

// The card beside the map: the three steps as tabs, and whichever step you're on. On a phone it's a
// sheet you can tuck away to see more of the land.
const d = useDesign()
const STEPS: { id: Step; title: string; sub: () => string }[] = [
  { id: 'land', title: 'Land', sub: () => (d.areaM2.value ? fmtAreaShort(d.areaM2.value, d.imperial.value) : 'trace it') },
  { id: 'rows', title: 'Rows', sub: () => (d.plot.rows.length ? `${d.plot.rows.length} rows` : 'lay out') },
  { id: 'plant', title: 'Plant', sub: () => (d.plot.plants.length ? `${d.plot.plants.length.toLocaleString()}` : 'choose') },
]
const can = (s: Step) => s === 'land' || d.plot.boundary.length >= 3
function go(s: Step) {
  if (!can(s)) return d.say('Stake out your land first.')
  d.step.value = s
  d.ui.panel = true
  d.setTool(s === 'plant' && d.selSpId.value ? 'place' : 'pan')
}
</script>

<template>
  <aside class="survey-dock step-dock" :class="{ tucked: !d.ui.panel }">
    <!-- two faces of one card: planting on the front, harvest on the back -->
    <div class="flip" :class="{ flipped: d.ui.harvest }">
      <div class="flip-inner">
        <div class="card survey-card face front" :inert="d.ui.harvest">
          <PlotBar />
          <nav class="steptabs" aria-label="Design steps">
            <button v-for="(s, i) in STEPS" :key="s.id" :class="{ on: d.step.value === s.id, off: !can(s.id) }" @click="go(s.id)">
              <i>{{ i + 1 }}</i><span><b>{{ s.title }}</b><small>{{ s.sub() }}</small></span>
            </button>
            <button v-if="d.ui.mobile" class="tuck" :aria-label="d.ui.panel ? 'Tuck the panel away' : 'Open the panel'" @click="d.ui.panel = !d.ui.panel">{{ d.ui.panel ? '▾' : '▴' }}</button>
          </nav>
          <Transition name="slide-r" mode="out-in">
            <LandPanel v-if="d.step.value === 'land'" key="land" />
            <RowsPanel v-else-if="d.step.value === 'rows'" key="rows" />
            <PlantPanel v-else key="plant" />
          </Transition>
        </div>
        <div class="card survey-card face back" :inert="!d.ui.harvest">
          <HarvestBody @close="d.ui.harvest = false" />
        </div>
      </div>
    </div>
  </aside>
</template>
