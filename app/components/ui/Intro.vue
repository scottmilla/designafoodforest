<script setup lang="ts">
import { ref } from 'vue'
import { fmtAreaShort } from '~/composables/useDesign'
import { polyAreaM2 } from '~/utils/geo'

// The title: the painted forest behind, one question in front.
const d = useDesign()
const q = ref('')
const file = ref<HTMLInputElement | null>(null)
function go() {
  if (q.value.trim()) d.locate(q.value.trim())
}
function openFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) d.importJSONFile(f)
  ;(e.target as HTMLInputElement).value = ''
}
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
</script>

<template>
  <div class="title">
    <p class="eyebrow">✦ a syntropic food forest, drawn on your own land ✦</p>
    <h1>Design a Food Forest</h1>
    <form class="card survey-card q1" @submit.prevent="go">
      <h2>Where is your land?</h2>
      <p class="lede">Type the address. We'll fly down onto it, read ten years of its sky, and hand you the tools to plant it.</p>
      <input v-model="q" class="field big-field" placeholder="1 Eden Canyon Rd, Castro Valley, CA" aria-label="Address, place or lat, lng" autocomplete="street-address" autofocus>
      <p v-if="d.error.value" class="err">{{ d.error.value }}</p>
      <button class="btn btn-primary big wide" :disabled="!q.trim() || d.locating.value">
        {{ d.locating.value ? 'Finding your land…' : 'Fly me there →' }}
      </button>
      <p class="fine">An address, a town, a farm name, or coordinates like <i>37.694, -122.073</i>.</p>

      <template v-if="d.saves.value.length">
        <h3>Your designs</h3>
        <ul class="saved">
          <li v-for="sv in d.saves.value.slice(0, 5)" :key="sv.id">
            <button type="button" class="open" @click="d.openSave(sv.id)">
              <b>{{ sv.name }}</b>
              <small>{{ sv.plot.plants.length.toLocaleString() }} plants · {{ fmtAreaShort(polyAreaM2(sv.plot.boundary)) }} · {{ ago(sv.savedAt) }}</small>
            </button>
          </li>
        </ul>
      </template>
      <button type="button" class="linkish" @click="file?.click()">📂 Open a design file (JSON from here or the Syntropic Designer)</button>
      <input ref="file" type="file" accept=".json" hidden @change="openFile">
    </form>
  </div>
</template>
