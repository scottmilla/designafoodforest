<script setup lang="ts">
import { computed, ref } from 'vue'
import { fmtAreaShort } from '~/composables/useDesign'

// The plots in this design (a home orchard, a far paddock, a market garden…), as in Byron's designer: pick one to
// edit it, show or hide the others on the map, rename, add, delete. The other plots are drawn faded on the map.
const d = useDesign()
const open = ref(false)
const active = computed(() => d.plotList.value.find((p) => p.active))
const many = computed(() => d.plotList.value.length > 1)
function remove(id: string, name: string) {
  if (confirm(`Delete “${name}” and everything in it (land, rows, plants, keylines)?`)) d.deletePlot(id)
}
function add() {
  d.newPlot()
  open.value = true
}
</script>

<template>
  <div class="plotbar" :class="{ open }">
    <button class="plot-cur" :aria-expanded="open" @click="open = !open">
      <span>📐 <b>{{ active?.name ?? 'Plot 1' }}</b><small v-if="many"> · {{ d.plotList.value.length }} plots</small></span>
      <span>{{ open ? '▾' : '▸' }}</span>
    </button>
    <div v-if="open" class="plot-menu">
      <label class="menu-name">
        <small>This plot's name</small>
        <input class="field" :value="active?.name" @change="d.renamePlot(d.activePlotId.value, ($event.target as HTMLInputElement).value)">
      </label>
      <ul class="plot-items">
        <li v-for="p in d.plotList.value" :key="p.id" :class="{ act: p.active }">
          <button class="eye" :disabled="p.active" :aria-label="p.visible ? `Hide ${p.name}` : `Show ${p.name}`" :title="p.active ? 'The plot you are editing is always shown' : 'Show or hide on the map'" @click="d.togglePlotVis(p.id)">{{ p.visible ? '👁' : '—' }}</button>
          <button class="pname" @click="d.activatePlot(p.id)">
            <b>{{ p.name }}<em v-if="p.active"> · editing</em></b>
            <small>{{ p.plants.toLocaleString() }} plants · {{ p.rows }} rows · {{ p.area ? fmtAreaShort(p.area, d.imperial.value) : 'no land yet' }}</small>
          </button>
          <button class="del" :aria-label="`Delete ${p.name}`" title="Delete this plot" @click="remove(p.id, p.name)">✕</button>
        </li>
      </ul>
      <div class="presets">
        <button class="chip tiny on" @click="add">＋ New plot</button>
        <template v-if="many">
          <button class="chip tiny" @click="d.setAllPlotsVis(true)">Show all</button>
          <button class="chip tiny" @click="d.setAllPlotsVis(false)">Hide others</button>
        </template>
      </div>
      <p class="fine tight">Each plot has its own land, rows and plants. Tap another plot's land on the map to edit it. A plot file from the Syntropic Designer (☰ → Open) is added as a new plot.</p>
    </div>
  </div>
</template>
