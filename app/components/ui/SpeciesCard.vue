<script setup lang="ts">
import { computed } from 'vue'
import { libById, LIFECYCLE, STRATA, yieldAt, yieldDefaults } from '~/utils/library'
import { fmtLen, fmtMass, fmtRange, fmtWindow } from '~/utils/fmt'
import { fmtZone } from '~/utils/library'

// The full Codex data card for a species, wherever you meet it: the library list, a plant tapped on the
// map, or a tree you walked up to in the forest.
const d = useDesign()
const player = usePlayer()

const plant = computed(() => {
  if (d.stage.value === 'forest' && d.selected.value !== null) {
    const p = d.scene.value.plants[d.selected.value]
    return p ? d.findPlant(p.id) : null
  }
  return d.inspect.value ? d.findPlant(d.inspect.value) : null
})
const sp = computed(() => (plant.value ? libById.get(plant.value.speciesId) : d.ui.card ? libById.get(d.ui.card) : null) ?? null)
const fit = computed(() => (sp.value ? d.fits.value.get(sp.value.id) : null))
const y = computed(() => (sp.value ? { ...yieldDefaults(sp.value, d.dash.density), ...(d.yields[sp.value.id] ?? {}) } : null))
const south = computed(() => (d.site.value?.lat ?? 0) < 0)
const rowOf = computed(() => (plant.value && plant.value.rowIdx >= 0 ? plant.value.rowIdx + 1 : null))

function close() {
  d.ui.card = null
  d.inspect.value = null
  d.selected.value = null
  player.focus = null
}
function remove() {
  if (!plant.value) return
  d.plot.plants = d.plot.plants.filter((x) => x.id !== plant.value!.id)
  d.changed()
  close()
}
function choose() {
  if (!sp.value) return
  d.selSpId.value = sp.value.id
  d.step.value = 'plant'
  d.setTool('place')
  close()
}
</script>

<template>
  <Transition name="pop">
    <div v-if="sp" class="scrim" @click.self="close">
      <article class="card plant" :style="{ '--accent': STRATA[sp.code].wash }">
        <button class="close" aria-label="Close" @pointerup.stop.prevent="close" @click="close">✕</button>
        <header>
          <div class="badge">{{ sp.emoji }}</div>
          <div>
            <p class="type">{{ STRATA[sp.code].name }} stratum · {{ sp.lifecycle }} lifecycle</p>
            <h2>{{ sp.name }}</h2>
            <p class="tag"><i>{{ sp.latin }}</i><template v-if="sp.strataNote"> · {{ sp.strataNote }}</template></p>
          </div>
        </header>
        <div class="pills">
          <span v-if="fit?.why" class="pill" :class="{ good: fit.level === 'good', warm: fit.level === 'edge', bad: fit.level === 'no' }">{{ fit.level === 'good' ? '✓' : fit.level === 'edge' ? '~' : '✕' }} {{ fit.why }}</span>
          <span v-for="c in sp.climates" :key="c" class="pill">{{ c }}</span>
          <span v-for="t in sp.pruningTags" :key="t" class="pill">✂️ {{ t }}</span>
          <span v-for="t in sp.soilTags" :key="t" class="pill">🪨 {{ t }}</span>
        </div>
        <p v-if="sp.ban" class="ban">⚠️ <b>Hard ban:</b> {{ sp.ban }}</p>
        <dl class="facts">
          <div><dt>Target spacing</dt><dd>{{ fmtRange(sp.targetRS, d.imperial.value) }}</dd></div>
          <div><dt>Design spacing</dt><dd>{{ fmtRange(sp.designRS, d.imperial.value) }}</dd></div>
          <div><dt>Mature size</dt><dd>{{ fmtLen(sp.heightM, d.imperial.value) }} × {{ fmtLen(sp.widthM, d.imperial.value) }}</dd></div>
          <div><dt>Succession</dt><dd>{{ sp.phase || LIFECYCLE[sp.lifecycle].label }}</dd></div>
          <template v-if="sp.food && y">
            <div><dt>First harvest</dt><dd>Year {{ y.first }}</dd></div>
            <div><dt>At peak</dt><dd>{{ fmtMass(y.perPlant, d.imperial.value) }} / plant<small v-if="!sp.yieldKg"> (est.)</small></dd></div>
            <div v-if="sp.harvest"><dt>Harvest</dt><dd>{{ fmtWindow(sp.harvest, south) }}</dd></div>
            <div><dt>In year {{ d.year.value }}</dt><dd>{{ yieldAt(y, d.year.value) ? fmtMass(yieldAt(y, d.year.value), d.imperial.value) : 'growing…' }}</dd></div>
          </template>
          <div v-if="sp.zMin !== undefined"><dt>Zones</dt><dd>{{ fmtZone(sp.zMin) }}–{{ fmtZone(sp.zMax!) }}</dd></div>
          <div v-if="d.counts.value.get(sp.id)"><dt>In this design</dt><dd>{{ d.counts.value.get(sp.id)?.toLocaleString() }}<template v-if="rowOf"> · this one on row {{ rowOf }}</template></dd></div>
        </dl>
        <h3>Soil</h3>
        <p class="desc">{{ sp.soil || '—' }}</p>
        <h3>Pruning</h3>
        <p class="desc">{{ sp.pruning || '—' }}</p>
        <h3>In the system</h3>
        <p class="desc">{{ sp.credit }}</p>
        <template v-if="sp.note">
          <h3>Technical note</h3>
          <p class="desc">{{ sp.note }}</p>
        </template>
        <div class="row gap-top">
          <button v-if="d.stage.value === 'map' && d.selSpId.value !== sp.id" class="btn btn-primary grow" @click="choose">✦ Plant this</button>
          <button v-if="plant && d.stage.value === 'map'" class="btn grow" @click="remove">⌫ Remove this one</button>
        </div>
        <p class="fine">From the Food-Forestry Codex (Byron Austin, VOL2_4). Yields are planning estimates.</p>
      </article>
    </div>
  </Transition>
</template>
