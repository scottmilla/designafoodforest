<script setup lang="ts">
import { computed } from 'vue'
import type { Code } from '#shared/types'
import { CODES, libById, OCCUPANCY, STRATA, yieldAt, yieldDefaults, type YieldCfg } from '~/utils/library'
import { fmtMass, fmtMoney } from '~/utils/fmt'

// What the design gives back, laid out like Byron's production dashboard: the headline numbers, the estimated
// yield of every target crop in the system, the year-by-year curve by stratum, and his editable per-crop table
// (per-plant yield, first / peak / end year, price). Seeded from real per-plant yields where we have them.
const d = useDesign()
const emit = defineEmits<{ close: [] }>()
const value = computed(() => d.dash.mode === 'value')
const cfg = (id: string): YieldCfg => ({ ...yieldDefaults(libById.get(id)!, d.dash.density), ...(d.yields[id] ?? {}) })

const model = computed(() => {
  const counts = d.counts.value
  const crops = [...counts.keys()].filter((id) => libById.get(id)?.food)
  const support = [...counts.keys()].filter((id) => !libById.get(id)?.food)
  const years = Array.from({ length: d.dash.horizon }, (_, i) => i + 1)
  const cfgs = new Map(crops.map((id) => [id, cfg(id)]))
  // A stratum planted past its canopy share (E 20%, H 40%, M 60%, L 80% of the land) shares that light, so each
  // plant in it yields proportionally less.
  const crown: Record<Code, number> = { E: 0, H: 0, M: 0, L: 0 }
  for (const [id, n] of counts) {
    const sp = libById.get(id)
    if (sp) crown[sp.code] += n * Math.PI * (sp.widthM / 2) ** 2
  }
  const land = d.areaM2.value || Infinity
  const crowd = (c: Code) => Math.min(1, (land * OCCUPANCY[c]) / Math.max(crown[c], 1))
  const per = (id: string, y: number) => {
    const c = cfgs.get(id)!
    return yieldAt(c, y) * counts.get(id)! * crowd(libById.get(id)!.code) * (value.value ? c.price : 1)
  }
  const rows = years.map((y) => {
    const by: Record<Code, number> = { E: 0, H: 0, M: 0, L: 0 }
    for (const id of crops) by[libById.get(id)!.code] += per(id, y)
    return { y, by, total: by.E + by.H + by.M + by.L }
  })
  const max = Math.max(1, ...rows.map((r) => r.total))
  const peak = rows.reduce((a, r) => (r.total > a.total ? r : a), rows[0]!)
  const cum = rows.reduce((a, r) => a + r.total, 0)
  const first = crops.length ? Math.min(...crops.map((id) => cfgs.get(id)!.first)) : 0
  // per crop: its own best year and what that is across all its plants
  const table = crops.map((id) => {
    const peakTotal = Math.max(...years.map((y) => per(id, y)))
    return { sp: libById.get(id)!, n: counts.get(id)!, c: cfgs.get(id)!, peakTotal, peakYear: years.find((y) => per(id, y) === peakTotal) ?? 0, crowd: crowd(libById.get(id)!.code) }
  }).sort((a, b) => b.peakTotal - a.peakTotal)
  const biggest = Math.max(1, ...table.map((t) => t.peakTotal))
  const crowded = CODES.filter((c) => crowd(c) < 0.95).map((c) => `${STRATA[c].name} ${Math.round((crown[c] / land) * 100)}%`)
  return { rows, max, peak, cum, first, table, biggest, crowded, support, supportNames: support.map((id) => libById.get(id)!.name).join(', '), hasCrops: crops.length > 0 }
})
const fmt = (v: number) => (value.value ? fmtMoney(v) : fmtMass(v, d.imperial.value))
function set(id: string, k: keyof YieldCfg, v: string) {
  d.yields[id] = { ...(d.yields[id] ?? {}), [k]: Math.max(0, parseFloat(v) || 0) }
  d.changed(false)
}
const noPrices = computed(() => value.value && model.value.table.some((r) => !r.c.price))
</script>

<template>
  <div class="harvest-body">
    <button class="close" aria-label="Back to planting" title="Back to planting" @click="emit('close')">↩</button>
    <p class="type">{{ d.name.value }}</p>
    <h2>What it gives back</h2>
    <div class="seg gap-top">
      <button class="chip tiny" :class="{ on: !value }" @click="d.dash.mode = 'yield'">🧺 Harvest</button>
      <button class="chip tiny" :class="{ on: value }" @click="d.dash.mode = 'value'">💰 Value</button>
      <label class="horizon">over <b>{{ d.dash.horizon }}</b> yrs <input v-model.number="d.dash.horizon" type="range" min="5" max="50" step="1" aria-label="Years to project"></label>
    </div>

    <p v-if="!model.hasCrops" class="lede gap-top">Plant some food species and their estimated yield shows up here, crop by crop and year by year.</p>
    <template v-else>
      <div class="stat-row">
        <div><b>{{ d.plot.plants.length.toLocaleString() }}</b><small>plants</small></div>
        <div><b>{{ model.table.length }}</b><small>target crops</small></div>
        <div><b>Yr {{ model.first }}</b><small>first harvest</small></div>
        <div><b>Yr {{ model.peak.y }}</b><small>peak year</small></div>
      </div>
      <div class="money">
        <p class="money-label">At peak, every year</p>
        <p class="money-num">{{ fmt(model.peak.total) }}</p>
        <p class="money-sub">{{ fmt(model.cum) }} over {{ d.dash.horizon }} years</p>
      </div>

      <h3>Estimated yield by crop <small>at each crop's best year</small></h3>
      <ul class="crops">
        <li v-for="t in model.table" :key="t.sp.id" :style="{ '--accent': STRATA[t.sp.code].wash, '--line': STRATA[t.sp.code].color }">
          <span class="fe">{{ t.sp.emoji }}</span>
          <span class="cn"><b>{{ t.sp.name }}</b><small>×{{ t.n.toLocaleString() }} · yr {{ t.c.first }}–{{ t.c.end }} · best yr {{ t.peakYear }}<template v-if="value"> · {{ t.c.price ? `$${(t.c.price / (d.imperial.value ? 2.20462 : 1)).toFixed(2)}/${d.imperial.value ? 'lb' : 'kg'}` : 'no price' }}</template></small></span>
          <span class="cv">{{ fmt(t.peakTotal) }}</span>
          <i class="cbar"><b :style="{ width: Math.max(2, (t.peakTotal / model.biggest) * 100) + '%' }" /></i>
        </li>
      </ul>
      <p v-if="model.support.length" class="fine tight">Support species with no harvest, here for shade, nitrogen and biomass: {{ model.supportNames }}.</p>

      <h3>Year by year, by strata</h3>
      <div class="bars stacked">
        <div v-for="r in model.rows" :key="r.y" class="bar-col" :class="{ now: r.y === d.year.value }" :title="`Year ${r.y}: ${fmt(r.total)}`">
          <span class="stack" :style="{ height: (r.total / model.max) * 100 + '%' }">
            <i v-for="c in CODES" :key="c" :style="{ flexGrow: r.by[c], background: STRATA[c].wash, borderColor: STRATA[c].color }" />
          </span>
          <small v-if="r.y === 1 || r.y % 5 === 0">{{ r.y }}</small>
        </div>
      </div>
      <p class="legend"><span v-for="c in CODES" :key="c"><i :style="{ background: STRATA[c].wash, borderColor: STRATA[c].color }" />{{ STRATA[c].name }}</span></p>

      <h3>Tune the numbers</h3>
      <div class="tune">
        <table>
          <thead><tr><th>Crop</th><th>{{ d.imperial.value ? 'lb' : 'kg' }}/plant</th><th>1st yr</th><th>peak</th><th>end</th><th>$/{{ d.imperial.value ? 'lb' : 'kg' }}</th></tr></thead>
          <tbody>
            <tr v-for="r in model.table" :key="r.sp.id">
              <td>{{ r.sp.emoji }} {{ r.sp.name }}</td>
              <td><input :value="Math.round(r.c.perPlant * (d.imperial.value ? 2.20462 : 1) * 10) / 10" type="number" min="0" step="0.5" @change="set(r.sp.id, 'perPlant', String(+($event.target as HTMLInputElement).value / (d.imperial.value ? 2.20462 : 1)))"></td>
              <td><input :value="r.c.first" type="number" min="0" step="1" @change="set(r.sp.id, 'first', ($event.target as HTMLInputElement).value)"></td>
              <td><input :value="r.c.peak" type="number" min="1" step="1" @change="set(r.sp.id, 'peak', ($event.target as HTMLInputElement).value)"></td>
              <td><input :value="r.c.end" type="number" min="1" step="1" @change="set(r.sp.id, 'end', ($event.target as HTMLInputElement).value)"></td>
              <td><input :value="Math.round(r.c.price / (d.imperial.value ? 2.20462 : 1) * 100) / 100" type="number" min="0" step="0.25" @change="set(r.sp.id, 'price', String(+($event.target as HTMLInputElement).value * (d.imperial.value ? 2.20462 : 1)))"></td>
            </tr>
          </tbody>
        </table>
        <label class="optin">Estimate for crops with no yield data: <input v-model.number="d.dash.density" class="field mini" type="number" min="0" step="0.1"> kg per m² of crown</label>
      </div>
      <p v-if="model.crowded.length" class="fine">🌳 Over its canopy share: {{ model.crowded.join(', ') }} of the land. Yields scaled down to match the light (Codex: E 20%, H 40%, M 60%, L 80%).</p>
      <p v-if="noPrices" class="fine">Some crops have no price yet: add one above to count them in Value.</p>
      <p class="fine">Estimates for comparing designs, not promises. Real yields depend on soil, water, care and market. Edit any cell with your own figures.</p>
    </template>
  </div>
</template>
