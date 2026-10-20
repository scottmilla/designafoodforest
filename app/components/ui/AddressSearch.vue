<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { GeoSuggestion } from '#shared/types'
import { browserCountry } from '~/composables/useDesign'

// The address box: type-ahead suggestions as you type (Esri's address points, good for rural US and NZ
// addresses), Enter or the button to search whatever is typed. Used on the title and on the map.
const props = withDefaults(defineProps<{ big?: boolean; placeholder?: string; button?: string; autofocus?: boolean }>(), {
  big: false, placeholder: 'Hebron, MD, USA', button: 'Fly me there →', autofocus: false,
})
const d = useDesign()
const q = ref('')
const list = ref<GeoSuggestion[]>([])
const open = ref(false)
const hi = ref(-1)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

watch(q, (v) => {
  clearTimeout(timer)
  hi.value = -1
  const t = v.trim()
  // coordinates, or too short to guess from: no suggestions
  if (t.length < 4 || /^-?\d+(\.\d+)?\s*[, ]\s*-?\d+(\.\d+)?$/.test(t)) {
    list.value = []
    return
  }
  timer = setTimeout(async () => {
    const my = ++seq
    try {
      const r = await $fetch<{ suggestions: GeoSuggestion[] }>('/api/geocode/suggest', { query: { q: t, cc: browserCountry() } })
      if (my === seq) {
        list.value = r.suggestions
        open.value = true
      }
    } catch {
      if (my === seq) list.value = []
    }
  }, 280)
})
onBeforeUnmount(() => clearTimeout(timer))

function choose(s: GeoSuggestion) {
  q.value = s.text
  open.value = false
  list.value = []
  seq++
  d.locate(s.text, s.key)
}
function go() {
  if (open.value && hi.value >= 0 && list.value[hi.value]) return choose(list.value[hi.value]!)
  const t = q.value.trim()
  if (!t) return
  open.value = false
  seq++
  d.locate(t)
}
function key(e: KeyboardEvent) {
  if (!open.value || !list.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    hi.value = (hi.value + 1) % list.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    hi.value = (hi.value - 1 + list.value.length) % list.value.length
  } else if (e.key === 'Escape') {
    open.value = false
  }
}
</script>

<template>
  <form class="addr" :class="{ big: props.big }" @submit.prevent="go">
    <div class="addr-box">
      <input
        v-model="q" class="field" :class="{ 'big-field': props.big }" :placeholder="props.placeholder" aria-label="Address, place or lat, lng"
        autocomplete="off" :autofocus="props.autofocus" role="combobox" :aria-expanded="open && list.length > 0" aria-autocomplete="list"
        @keydown="key" @focus="open = list.length > 0" @blur="open = false"
      >
      <ul v-if="open && list.length" class="addr-list card" role="listbox">
        <li v-for="(s, i) in list" :key="s.key" role="option" :aria-selected="i === hi" :class="{ hi: i === hi }" @pointerdown.prevent="choose(s)">📍 {{ s.text }}</li>
      </ul>
    </div>
    <p v-if="d.error.value" class="err">{{ d.error.value }}</p>
    <button class="btn btn-primary" :class="{ big: props.big, wide: props.big }" :disabled="!q.trim() || d.locating.value">
      {{ d.locating.value ? 'Finding your land…' : props.button }}
    </button>
  </form>
</template>
