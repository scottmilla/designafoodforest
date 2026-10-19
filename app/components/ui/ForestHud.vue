<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fmtTemp } from '~/utils/fmt'
import { plantGrowth } from '~/utils/growth'

// Standing in the design: walk it, scrub the years to watch succession, look from above, go back to the map.
const d = useDesign()
const player = usePlayer()
const clock = computed(() => {
  const h = d.env.value.hour
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`
})
const seasonText = computed(() => {
  const e = d.env.value
  if (e.lush) {
    const south = (d.site.value?.lat ?? 0) < 0
    const wet = south ? e.month >= 11 || e.month <= 4 : e.month >= 5 && e.month <= 10
    return wet ? '🌧️ rainy season' : '☀️ dry season'
  }
  return { spring: '🌸', summer: '🌻', autumn: '🍂', winter: '❄️' }[e.season] + ' ' + e.season
})
// average crown size this year, as a share of full size, over the plants still standing
const crownPct = computed(() => {
  const sc = d.scene.value
  let sum = 0
  let n = 0
  for (const p of sc.plants) {
    const g = plantGrowth(sc.species[p.s]!, d.year.value, p.rank)
    if (g > 0.001) { sum += g; n++ }
  }
  return n ? Math.round((sum / n) * 100) : 0
})
const night = computed(() => d.env.value.day < 0.2)
// what the year slider means for this design
const yearNote = computed(() => {
  const y = d.year.value
  const sc = d.scene.value
  const gone = sc.species.filter((sp) => sp.succession === 'placenta' && sp.form !== 'herb' && sp.form !== 'shrub' && y > sp.lifespanYears + 0.5).length
  const fruiting = sc.species.filter((sp) => sp.food && y >= sp.yearsToFruit).length
  return `${fruiting} of ${sc.species.length} species fruiting${gone ? ` · ${gone} placenta crop${gone > 1 ? 's' : ''} done` : ''}`
})
// compass: the rose counter-rotates with the camera, so N always points at true north
const heading = ref(0) // degrees clockwise from north that the view faces
let raf = 0
const tick = () => {
  heading.value = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360
  raf = requestAnimationFrame(tick)
}
onMounted(tick)
onBeforeUnmount(() => cancelAnimationFrame(raf))
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const facing = computed(() => POINTS[Math.round(heading.value / 45) % 8])
function faceNorth() {
  // nearest whole turn, so it never spins the long way round
  player.yawTarget = Math.round(player.yaw / (Math.PI * 2)) * Math.PI * 2
}
function back() {
  d.exitForest({ x: player.x, z: player.z })
}
</script>

<template>
  <div class="hud">
    <div class="hud-left">
      <section class="climate" :class="{ compact: d.ui.mobile }">
      <p class="place">📍 {{ d.name.value || d.geo.value?.label }}</p>
      <p v-if="d.site.value" class="zone"><b>Zone {{ d.site.value.zoneLabel }}</b> · {{ d.scene.value.plants.length.toLocaleString() }} plants</p>
      <p class="now">
        {{ d.ui.forceDay ? '☀️' : d.env.value.icon }}
        <template v-if="d.weather.value && !d.ui.forceDay">{{ fmtTemp(d.weather.value.tempC, d.imperial.value) }} · {{ d.env.value.label }}</template>
        <template v-else>Daylight preview</template>
      </p>
      <p class="meta">{{ clock }} · <span class="season">{{ seasonText }}</span></p>
      <button v-if="night || d.ui.forceDay" class="chip tiny" @click="d.ui.forceDay = !d.ui.forceDay">{{ d.ui.forceDay ? '🌙 Back to live sky' : '☀️ See it by day' }}</button>
      <button class="compass" :aria-label="`Facing ${facing}. Click to face north`" title="Click to face north" @click="faceNorth">
        <svg viewBox="-50 -50 100 100" :style="{ transform: `rotate(${-heading}deg)` }" aria-hidden="true">
          <circle r="46" class="c-face" />
          <g class="c-ticks"><line v-for="i in 8" :key="i" x1="0" y1="-46" x2="0" :y2="i % 2 ? -38 : -41" :transform="`rotate(${i * 45})`" /></g>
          <path d="M0 -36 L9 0 L-9 0 Z" class="c-n" />
          <path d="M0 36 L9 0 L-9 0 Z" class="c-s" />
          <circle r="3" class="c-hub" />
          <text y="-24" class="c-t" x="0">N</text>
        </svg>
        <span class="c-read">{{ facing }} · {{ Math.round(heading) }}°</span>
      </button>
    </section>
      <HarvestPanel />
    </div>

    <div class="tools">
      <button class="chip back" @click="back">🛰 Back to the map</button>
      <button class="chip" :class="{ on: d.ui.birdseye }" @click="d.ui.birdseye = !d.ui.birdseye; d.selected.value = null">🦅 Bird's-eye</button>
      <button class="chip" :class="{ on: d.ui.satGround }" @click="d.ui.satGround = !d.ui.satGround">{{ d.ui.satGround ? '🛰 Photo ground' : '🎨 Painted ground' }}</button>
      <button class="chip" :class="{ on: d.ui.harvest }" @click="d.ui.harvest = !d.ui.harvest">📊 Harvest</button>
      <div class="orbit" role="group" aria-label="Rotate the view">
        <button class="chip" aria-label="Rotate left" @pointerdown.prevent="d.input.rotL = true" @pointerup="d.input.rotL = false" @pointerleave="d.input.rotL = false" @pointercancel="d.input.rotL = false">◀</button>
        <button class="chip" :class="{ on: d.ui.autoOrbit }" aria-label="Slow auto-orbit" :aria-pressed="d.ui.autoOrbit" @click="d.ui.autoOrbit = !d.ui.autoOrbit">🎥</button>
        <button class="chip" aria-label="Rotate right" @pointerdown.prevent="d.input.rotR = true" @pointerup="d.input.rotR = false" @pointerleave="d.input.rotR = false" @pointercancel="d.input.rotR = false">▶</button>
      </div>
    </div>

    <div class="bottom">
      <div class="timeline">
        <span>Year <b>{{ d.year.value }}</b></span>
        <input v-model.number="d.year.value" type="range" min="1" max="30" step="1" aria-label="Years after planting">
        <div class="meter" role="meter" aria-label="Crown size, as a share of mature size" :aria-valuenow="crownPct" aria-valuemin="0" aria-valuemax="100" title="How full-grown the crowns are this year, averaged over the plants still standing (each species grows on its own lifecycle clock)">
          <small>Crowns {{ crownPct }}% grown</small>
          <i><b :style="{ width: crownPct + '%' }" /></i>
        </div>
        <small>{{ yearNote }}</small>
        <small class="for-mouse"><kbd>↑</kbd><kbd>↓</kbd> walk · <kbd>←</kbd><kbd>→</kbd> turn the camera · scroll to zoom · click a plant</small>
        <small class="for-touch">Tap to walk · ◀ ▶ to spin · tap a plant</small>
      </div>
    </div>
    <p v-if="!d.scene.value.plants.length" class="empty-forest card">Nothing planted yet. Go back to the map, lay out rows and plant, then step in again.</p>
    <Transition name="toast"><div v-if="d.toast.value" class="toast">{{ d.toast.value }}</div></Transition>
  </div>
</template>
