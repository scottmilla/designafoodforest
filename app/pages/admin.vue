<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Code, CodexClimate, LibSpecies } from '#shared/types'
import {
  blankSpecies, CLIMATES, CODES, FORMS, LAYERS, LIFECYCLES, REGIONS, ROLES, SUCCESSIONS, USES, validateSpecies,
} from '#shared/speciesSchema'
import { CLIMATE_TAGS, STRATA } from '~/utils/library'
import { MONTH_NAMES } from '~/utils/fmt'

// /admin: the species library editor. Signs in with the admin password (NUXT_ADMIN_PASSWORD), reads and writes
// the species in MongoDB (NUXT_MONGODB_URI). Every save is checked by shared/speciesSchema.ts, here and on the server.
useHead({ title: 'Species library · Design a Food Forest' })

interface Status { configured: boolean; signedIn: boolean; db: 'none' | 'connected' | 'error'; dbError: string | null; count: number; bundled: number }
const status = ref<Status | null>(null)
const password = ref('')
const loginError = ref('')
const list = ref<LibSpecies[]>([])
const source = ref<'db' | 'bundled'>('bundled')
const q = ref('')
const strata = ref<Code | null>(null)
const climates = ref<CodexClimate[]>([])
const form = ref<LibSpecies | null>(null)
const isNew = ref(false)
const errors = ref<string[]>([])
const note = ref('')
const busy = ref(false)
const dirty = ref(false)

const err = (e: any) => e?.data?.statusMessage || e?.statusMessage || e?.message || 'Something went wrong.'
async function loadStatus() {
  status.value = await $fetch<Status>('/api/admin/status')
  if (status.value.signedIn) await loadList()
}
async function loadList() {
  const r = await $fetch<{ species: LibSpecies[]; source: 'db' | 'bundled'; error?: string }>('/api/admin/species')
  list.value = r.species
  source.value = r.source
  if (r.error) note.value = r.error
}
onMounted(loadStatus)

async function login() {
  loginError.value = ''
  try {
    await $fetch('/api/admin/login', { method: 'POST', body: { password: password.value } })
    password.value = ''
    await loadStatus()
  } catch (e) {
    loginError.value = err(e)
  }
}
async function logout() {
  await $fetch('/api/admin/logout', { method: 'POST' })
  form.value = null
  await loadStatus()
}

const canWrite = computed(() => status.value?.db === 'connected')
const editable = computed(() => canWrite.value && source.value === 'db')
const shown = computed(() => {
  const t = q.value.trim().toLowerCase()
  return list.value.filter((s) => (!strata.value || s.code === strata.value) && (!climates.value.length || s.climates.some((c) => climates.value.includes(c))) && (!t || s.name.toLowerCase().includes(t) || s.latin.toLowerCase().includes(t) || s.id.includes(t)))
})

function open(sp: LibSpecies) {
  if (dirty.value && !confirm('Discard your unsaved changes?')) return
  form.value = JSON.parse(JSON.stringify(sp))
  isNew.value = false
  errors.value = []
  note.value = ''
  dirty.value = false
}
function create(from?: LibSpecies) {
  if (dirty.value && !confirm('Discard your unsaved changes?')) return
  form.value = from ? { ...JSON.parse(JSON.stringify(from)), id: '', name: `${from.name} (copy)` } : blankSpecies()
  isNew.value = true
  errors.value = []
  note.value = ''
  dirty.value = true
}
watch(form, () => (dirty.value = true), { deep: true, flush: 'sync' })

async function save() {
  if (!form.value) return
  const local = validateSpecies(form.value)
  if (!local.ok) {
    errors.value = local.errors
    return
  }
  busy.value = true
  errors.value = []
  try {
    const r = isNew.value
      ? await $fetch<{ species: LibSpecies }>('/api/admin/species', { method: 'POST', body: local.value })
      : await $fetch<{ species: LibSpecies }>(`/api/admin/species/${encodeURIComponent(local.value.id)}`, { method: 'PUT', body: local.value })
    await loadList()
    form.value = r.species
    isNew.value = false
    await Promise.resolve()
    dirty.value = false
    note.value = `Saved ${r.species.name}. The designer picks it up on its next load.`
  } catch (e: any) {
    errors.value = e?.data?.data?.errors ?? [err(e)]
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!form.value || isNew.value) return
  if (!confirm(`Delete ${form.value.name} (${form.value.id}) from the library? Designs that use it will skip those plants.`)) return
  busy.value = true
  try {
    await $fetch(`/api/admin/species/${encodeURIComponent(form.value.id)}`, { method: 'DELETE' })
    note.value = `Deleted ${form.value.name}.`
    form.value = null
    dirty.value = false
    await loadList()
  } catch (e) {
    errors.value = [err(e)]
  } finally {
    busy.value = false
  }
}
async function seed(replace = false) {
  if (replace && !confirm('Put every bundled Codex species back as shipped? Your edits to those species are lost; species you added stay.')) return
  busy.value = true
  try {
    const r = await $fetch<{ total: number }>('/api/admin/seed', { method: 'POST', body: { replace } })
    note.value = `The database now holds ${r.total} species.`
    await loadStatus()
  } catch (e) {
    note.value = err(e)
  } finally {
    busy.value = false
  }
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(list.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'species-library.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1500)
}

// list fields typed as comma-separated text
const csv = {
  get: (k: 'soilTags' | 'pruningTags' | 'roles' | 'uses') => form.value?.[k].join(', ') ?? '',
  set: (k: 'soilTags' | 'pruningTags' | 'roles' | 'uses', v: string) => {
    if (form.value) form.value[k] = v.split(',').map((s) => s.trim()).filter(Boolean)
  },
}
function toggle<T extends string>(arr: T[], v: T) {
  const i = arr.indexOf(v)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(v)
}
const num = (v: string) => (v === '' ? undefined : Number(v))
function setOpt(k: 'zMin' | 'zMax' | 'zEdge' | 'chill' | 'pricePerKg', v: string) {
  if (!form.value) return
  const n = num(v)
  if (n === undefined) delete form.value[k]
  else form.value[k] = n
}
function setNull(k: 'frostKillC' | 'hardyC', v: string) {
  if (form.value) form.value[k] = v === '' ? null : Number(v)
}
function setHarvest(i: 0 | 1, v: string) {
  if (!form.value) return
  if (v === '') return void delete form.value.harvest
  const h = form.value.harvest ?? [Number(v), Number(v)]
  h[i] = Number(v)
  form.value.harvest = [h[0], h[1]]
}
</script>

<template>
  <div class="admin">
    <header class="admin-top">
      <h1>🌳 Species library <small>admin</small></h1>
      <div class="row wrap">
        <NuxtLink to="/" class="chip">← The designer</NuxtLink>
        <template v-if="status?.signedIn">
          <span class="chip tiny badge-db" :class="status.db">
            {{ status.db === 'connected' ? (source === 'db' ? `🗄 Database · ${list.length} species` : '🗄 Database connected · empty') : status.db === 'error' ? '⚠ Database not answering' : '📦 No database: bundled library (read-only)' }}
          </span>
          <button class="chip" :disabled="!editable || busy" @click="create()">＋ New species</button>
          <button class="chip" :disabled="!list.length" @click="exportJSON">⬇ Export JSON</button>
          <button class="chip" @click="logout">Sign out</button>
        </template>
      </div>
    </header>

    <!-- not set up / sign in -->
    <section v-if="status && !status.configured" class="card admin-card">
      <h2>The admin panel isn't set up</h2>
      <p>Set <code>NUXT_ADMIN_PASSWORD</code> on the server (and <code>NUXT_MONGODB_URI</code> for the database), then reload. See <code>.env.example</code>.</p>
    </section>
    <form v-else-if="status && !status.signedIn" class="card admin-card" @submit.prevent="login">
      <h2>Sign in</h2>
      <input v-model="password" class="field" type="password" autocomplete="current-password" placeholder="Admin password" aria-label="Admin password" autofocus>
      <p v-if="loginError" class="err">{{ loginError }}</p>
      <button class="btn btn-primary wide gap-top" :disabled="!password">Sign in</button>
    </form>

    <template v-else-if="status?.signedIn">
      <section v-if="status.db === 'error'" class="card admin-card note bad">
        <b>⚠ Can't reach the species database.</b> {{ status.dbError }}
        <span class="fine tight">Change it in your hosting's environment variables (Vercel → Settings → Environment Variables), redeploy, then reload this page.</span>
        <button class="chip gap-top" :disabled="busy" @click="loadStatus">↻ Try again</button>
      </section>
      <section v-else-if="status.db === 'none'" class="card admin-card note">
        <b>No database connected.</b> You're looking at the bundled Codex library. To edit it, set <code>NUXT_MONGODB_URI</code> (MongoDB Atlas works well) and reload.
      </section>
      <section v-else-if="status.db === 'connected' && source === 'bundled'" class="card admin-card note">
        <b>The database is connected but empty.</b> Copy the {{ status.bundled }} bundled Codex species into it to start editing.
        <button class="btn btn-primary gap-top" :disabled="busy" @click="seed(false)">⬆ Copy the bundled library into the database</button>
      </section>
      <p v-if="note" class="admin-note">{{ note }}</p>

      <div class="admin-grid">
        <!-- the list -->
        <aside class="card admin-list">
          <input v-model="q" class="field" type="search" placeholder="Search name, Latin or id…" aria-label="Search species">
          <div class="presets">
            <button v-for="c in CODES" :key="c" class="chip tiny" :class="{ on: strata === c }" @click="strata = strata === c ? null : c">{{ c }} · {{ STRATA[c].name }}</button>
          </div>
          <div class="presets">
            <button v-for="c in CLIMATE_TAGS" :key="c.id" class="chip tiny" :class="{ on: climates.includes(c.id) }" :aria-pressed="climates.includes(c.id)" @click="climates = climates.includes(c.id) ? climates.filter((x) => x !== c.id) : [...climates, c.id]">{{ c.emoji }} {{ c.id }}</button>
          </div>
          <p class="fine tight">{{ shown.length }} of {{ list.length }}</p>
          <ul>
            <li v-for="sp in shown" :key="sp.id">
              <button :class="{ sel: form?.id === sp.id && !isNew }" :style="{ '--accent': STRATA[sp.code].wash }" @click="open(sp)">
                <span class="fe">{{ sp.emoji }}</span>
                <span class="fi"><b>{{ sp.name }}</b><small><i>{{ sp.latin }}</i> · {{ sp.code }} · {{ sp.id }}</small></span>
              </button>
            </li>
          </ul>
          <button v-if="editable" class="linkish" :disabled="busy" @click="seed(true)">Reset bundled species to the shipped Codex…</button>
        </aside>

        <!-- the editor -->
        <section v-if="form" class="card admin-edit">
          <header class="row wrap">
            <span class="badge sm">{{ form.emoji }}</span>
            <h2 class="grow">{{ form.name || 'New species' }} <small v-if="!isNew">{{ form.id }}</small></h2>
            <button class="btn btn-primary" :disabled="!editable || busy || !dirty" @click="save">{{ busy ? 'Saving…' : isNew ? 'Add species' : 'Save' }}</button>
            <button v-if="!isNew" class="chip" :disabled="!editable || busy" @click="create(form)">Duplicate</button>
            <button v-if="!isNew" class="chip danger" :disabled="!editable || busy" @click="remove">Delete</button>
          </header>
          <p v-if="!editable" class="fine">Read-only: {{ canWrite ? 'copy the bundled library into the database first.' : 'connect a database to edit.' }}</p>
          <ul v-if="errors.length" class="err-list"><li v-for="(e, i) in errors" :key="i">{{ e }}</li></ul>

          <fieldset :disabled="!editable">
            <h3>Identity</h3>
            <div class="fgrid">
              <label>Name<input v-model="form.name" class="field"></label>
              <label>Latin<input v-model="form.latin" class="field"></label>
              <label>Stratum<select v-model="form.code" class="field"><option v-for="c in CODES" :key="c" :value="c">{{ c }} · {{ STRATA[c].name }}</option></select></label>
              <label>Strata note<input v-model="form.strataNote" class="field" placeholder="managed to H…"></label>
              <label>Emoji<input v-model="form.emoji" class="field"></label>
              <label>Plant form (3D)<select v-model="form.form" class="field"><option v-for="f in FORMS" :key="f">{{ f }}</option></select></label>
              <label>Leaf colour<input v-model="form.leaf" class="field" type="color"></label>
              <label>Fruit colour<input :value="form.fruit ?? '#d94b4b'" class="field" type="color" @input="form.fruit = ($event.target as HTMLInputElement).value"></label>
            </div>
            <p v-if="isNew" class="fine">The id is made from the name and stratum when you add it, and doesn't change after (designs refer to it).</p>

            <h3>Size & spacing (metres)</h3>
            <div class="fgrid">
              <label>Height<input v-model.number="form.heightM" class="field" type="number" step="0.1" min="0"></label>
              <label>Canopy width<input v-model.number="form.widthM" class="field" type="number" step="0.1" min="0"></label>
              <label>Target RS from<input v-model.number="form.targetRS[0]" class="field" type="number" step="0.05" min="0"></label>
              <label>Target RS to<input v-model.number="form.targetRS[1]" class="field" type="number" step="0.05" min="0"></label>
              <label>Design RS from<input v-model.number="form.designRS[0]" class="field" type="number" step="0.05" min="0"></label>
              <label>Design RS to<input v-model.number="form.designRS[1]" class="field" type="number" step="0.05" min="0"></label>
              <label class="span2">Dimensions, as the card writes it<input v-model="form.dims" class="field"></label>
            </div>

            <h3>Lifecycle & succession</h3>
            <div class="fgrid">
              <label>Lifecycle<select v-model="form.lifecycle" class="field"><option v-for="l in LIFECYCLES" :key="l">{{ l }}</option></select></label>
              <label>Succession<select v-model="form.succession" class="field"><option v-for="l in SUCCESSIONS" :key="l">{{ l }}</option></select></label>
              <label>3D layer<select v-model="form.layer" class="field"><option v-for="l in LAYERS" :key="l">{{ l }}</option></select></label>
              <label>Lifespan (years)<input v-model.number="form.lifespanYears" class="field" type="number" min="1"></label>
              <label class="span2">Phase<input v-model="form.phase" class="field" placeholder="Mid Secondary → Late Secondary"></label>
              <label class="check"><input v-model="form.deciduous" type="checkbox"> Deciduous</label>
              <label class="check"><input v-model="form.pollard" type="checkbox"> Pollarded / coppiced</label>
            </div>

            <h3>Climate & site fit</h3>
            <div class="chips">
              <button v-for="c in CLIMATES" :key="c" type="button" class="chip tiny" :class="{ on: form.climates.includes(c) }" @click="toggle(form.climates, c)">{{ c }}</button>
            </div>
            <div class="fgrid">
              <label>Coldest zone<input :value="form.zMin ?? ''" class="field" type="number" step="0.5" @input="setOpt('zMin', ($event.target as HTMLInputElement).value)"></label>
              <label>Warmest zone<input :value="form.zMax ?? ''" class="field" type="number" step="0.5" @input="setOpt('zMax', ($event.target as HTMLInputElement).value)"></label>
              <label>Typical types need zone<input :value="form.zEdge ?? ''" class="field" type="number" step="0.5" @input="setOpt('zEdge', ($event.target as HTMLInputElement).value)"></label>
              <label>Chill hours<input :value="form.chill ?? ''" class="field" type="number" min="0" @input="setOpt('chill', ($event.target as HTMLInputElement).value)"></label>
              <label>Killed below °C<input :value="form.frostKillC ?? ''" class="field" type="number" @input="setNull('frostKillC', ($event.target as HTMLInputElement).value)"></label>
              <label>Hardy to °C<input :value="form.hardyC ?? ''" class="field" type="number" @input="setNull('hardyC', ($event.target as HTMLInputElement).value)"></label>
              <label class="span2">Cold-edge note<input v-model="form.zEdgeNote" class="field" placeholder="choose the hardy types…"></label>
              <label class="span2">Climate, as the card writes it<input v-model="form.climateRaw" class="field"></label>
              <label class="span2">⚠️ Hard ban<textarea :value="form.ban ?? ''" class="field" rows="2" @input="form.ban = ($event.target as HTMLTextAreaElement).value || null" /></label>
            </div>

            <h3>Harvest</h3>
            <div class="fgrid">
              <label class="check"><input v-model="form.food" type="checkbox"> Grown for food</label>
              <label>Years to first harvest<input v-model.number="form.yearsToFruit" class="field" type="number" min="0"></label>
              <label>Yield kg / plant / year<input v-model.number="form.yieldKg" class="field" type="number" min="0" step="0.5"></label>
              <label>Price $ / kg<input :value="form.pricePerKg ?? ''" class="field" type="number" min="0" step="0.25" @input="setOpt('pricePerKg', ($event.target as HTMLInputElement).value)"></label>
              <label>Harvest from (N. hemisphere)<select :value="form.harvest?.[0] ?? ''" class="field" @change="setHarvest(0, ($event.target as HTMLSelectElement).value)"><option value="">—</option><option v-for="(m, i) in MONTH_NAMES" :key="m" :value="i + 1">{{ m }}</option></select></label>
              <label>to<select :value="form.harvest?.[1] ?? ''" class="field" :disabled="!form.harvest" @change="setHarvest(1, ($event.target as HTMLSelectElement).value)"><option v-for="(m, i) in MONTH_NAMES" :key="m" :value="i + 1">{{ m }}</option></select></label>
            </div>

            <h3>Roles in the system</h3>
            <div class="fgrid">
              <label class="check"><input v-model="form.support" type="checkbox"> Support species (biomass / nitrogen / pioneer)</label>
              <label class="check"><input v-model="form.invasive" type="checkbox"> Can be invasive</label>
              <label class="check"><input v-model="form.rare" type="checkbox"> Rare / collector</label>
              <label class="check"><input v-model="form.dry" type="checkbox"> Copes with a long dry season</label>
            </div>
            <label class="block">Roles <small>(comma separated: {{ ROLES.join(', ') }})</small><input :value="csv.get('roles')" class="field" @change="csv.set('roles', ($event.target as HTMLInputElement).value)"></label>
            <label class="block">Herb uses <small>({{ USES.join(', ') }})</small><input :value="csv.get('uses')" class="field" @change="csv.set('uses', ($event.target as HTMLInputElement).value)"></label>
            <p class="lbl">Native to</p>
            <div class="chips">
              <button v-for="r in REGIONS" :key="r" type="button" class="chip tiny" :class="{ on: form.natives.includes(r) }" @click="toggle(form.natives, r)">{{ r }}</button>
            </div>

            <h3>From the Codex card</h3>
            <label class="block">Soil<textarea v-model="form.soil" class="field" rows="2" /></label>
            <label class="block">Soil tags <small>(comma separated)</small><input :value="csv.get('soilTags')" class="field" @change="csv.set('soilTags', ($event.target as HTMLInputElement).value)"></label>
            <label class="block">Pruning<textarea v-model="form.pruning" class="field" rows="2" /></label>
            <label class="block">Pruning tags <small>(comma separated)</small><input :value="csv.get('pruningTags')" class="field" @change="csv.set('pruningTags', ($event.target as HTMLInputElement).value)"></label>
            <div class="fgrid">
              <label class="span2">Succession credit<textarea v-model="form.credit" class="field" rows="2" /></label>
              <label>Credit level<input v-model="form.creditLevel" class="field" placeholder="High / Moderate / Low"></label>
            </div>
            <label class="block">Technical note<textarea v-model="form.note" class="field" rows="3" /></label>
          </fieldset>
        </section>
        <section v-else class="card admin-edit empty">
          <p>Pick a species on the left to see or edit its card{{ editable ? ', or add a new one' : '' }}.</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin { position: fixed; inset: 0; overflow-y: auto; touch-action: auto; user-select: text; -webkit-user-select: text; padding: 16px; background: linear-gradient(170deg, #f6efdc, #e9f2dc); }
.admin-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .6rem; margin-bottom: 1rem; }
.admin-top h1 { margin: 0; font-size: 1.8rem; }
.admin-top h1 small { font-size: .9rem; opacity: .6; font-family: var(--font-body, inherit); }
.row.wrap { flex-wrap: wrap; }
.admin-card { max-width: 560px; margin: 0 auto 1rem; }
.admin-card.note { max-width: none; display: grid; gap: .3rem; }
.admin-note { font-weight: 600; margin: 0 0 .8rem; }
.badge-db.connected { background: #d9f2c9; }
.badge-db.error { background: #ffd6d0; }
.admin-grid { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 1rem; align-items: start; }
@media (max-width: 800px) { .admin-grid { grid-template-columns: minmax(0, 1fr); } }
.admin-list { position: sticky; top: 0; max-height: calc(100dvh - 120px); overflow-y: auto; display: grid; gap: .4rem; }
.admin-list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
.admin-list li button { width: 100%; display: flex; gap: .5rem; align-items: center; text-align: left; font: inherit; color: var(--ink); cursor: pointer; padding: .3em .5em; border: 2px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--accent, #ccc) 18%, #fffdf6); }
.admin-list li button.sel { border-color: var(--ink); background: color-mix(in srgb, var(--accent, #ccc) 45%, #fffdf6); }
.admin-list .fe { font-size: 1.3rem; }
.admin-list .fi { display: grid; min-width: 0; line-height: 1.15; }
.admin-list .fi small { font-size: .74rem; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.admin-edit { min-width: 0; }
.admin-edit.empty { opacity: .7; }
.admin-edit header h2 { margin: 0; font-size: 1.5rem; }
.admin-edit header h2 small { font-size: .8rem; opacity: .55; font-family: monospace; }
.admin-edit h3 { margin: 1.2rem 0 .5rem; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
fieldset:disabled { opacity: .85; }
.fgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .5rem .7rem; }
.fgrid label, label.block { display: grid; gap: .15rem; font-size: .8rem; font-weight: 700; }
label.block { margin-top: .5rem; }
label.block small { font-weight: 500; opacity: .65; }
.fgrid .span2 { grid-column: span 2; }
@media (max-width: 520px) { .fgrid .span2 { grid-column: auto; } }
.fgrid .check { display: flex; align-items: center; gap: .4rem; font-weight: 600; }
.fgrid input[type='color'] { padding: .15em; height: 2.4em; }
.chips { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .5rem; }
.chips .chip.tiny { margin: 0; }
.lbl { font-size: .8rem; font-weight: 700; margin: .7rem 0 .3rem; }
.err-list { color: #b3261e; font-weight: 600; margin: .6rem 0; padding-left: 1.2rem; }
.chip.danger:hover { background: #ffd6d0; }
.admin-card.note.bad { background: #ffeae6; border-color: #b3261e; }
code { background: #fff8e8; padding: 0 .3em; border-radius: 4px; }
</style>
