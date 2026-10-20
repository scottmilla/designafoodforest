<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Code, LibSpecies } from '#shared/types'
import type { RecipeStep, Scope } from '~/composables/useDesign'
import { CODES, codexWidthOf, libById, LIFECYCLE, OCCUPANCY, search, STRATA } from '~/utils/library'
import { fmtDist, fmtLen, fmtRange, fmtSpan, fromUnit, lenUnit, toUnit } from '~/utils/fmt'
import { GOALS, GROUP_NAME, suggestDesign, type Goal, type Suggestion } from '~/utils/suggest'
import { DENSITY, supportCandidates, type Density } from '~/utils/support'

// Step 3: choose from the Codex library (already filtered to what grows at this address), then place
// one at a time, fill whole rows at the Codex spacing, or plant a layered consortium in one go.
const d = useDesign()
const q = ref('')
const strata = ref<Code | null>(null)
const kind = ref<'all' | 'food' | 'support'>('all')
const steps = ref<RecipeStep[]>([])
const recipeMode = ref<'mix' | 'layers' | 'sequence'>('mix')
const goals = ref<Goal[]>([])
const suggestion = ref<Suggestion | null>(null)
const scope = ref<Scope>('all')

const list = computed(() => {
  const fits = d.fits.value
  return search(d.cards.value, q.value).filter((sp) => {
    if (!q.value && !d.ui.showAll && fits.get(sp.id)?.level === 'no') return false
    if (strata.value && sp.code !== strata.value) return false
    if (kind.value === 'food' && !sp.food) return false
    if (kind.value === 'support' && !sp.support) return false
    return true
  })
})
const grouped = computed(() => CODES.map((c) => ({ c, items: list.value.filter((s) => s.code === c).sort((a, b) => rankFit(a) - rankFit(b) || a.name.localeCompare(b.name)) })).filter((g) => g.items.length))
const hidden = computed(() => d.cards.value.filter((sp) => d.fits.value.get(sp.id)?.level === 'no').length)
const rankFit = (sp: LibSpecies) => ({ good: 0, edge: 1, no: 2 })[d.fits.value.get(sp.id)?.level ?? 'good']
const dot = (sp: LibSpecies) => ({ good: '🟢', edge: '🟡', no: '🔴' })[d.fits.value.get(sp.id)?.level ?? 'good']
const sel = computed(() => d.selSp.value)
const selFit = computed(() => (sel.value ? d.fits.value.get(sel.value.id) : null))

function pick(sp: LibSpecies) {
  if (d.selSpId.value === sp.id) {
    d.selSpId.value = null
    d.setTool('pan')
    return
  }
  d.selSpId.value = sp.id
  d.setTool('place')
  // bring its spacing card and fill buttons into view
  nextTick(() => document.querySelector('.step-dock .card')?.scrollTo({ top: 0, behavior: 'smooth' }))
}
function fill(sc: Scope, force = false) {
  if (!sel.value) return
  const n = d.fillRows(sel.value.id, sc, 0.5, true, undefined, force)
  const b = d.lastBlocked.value
  const where = sc === 'all' ? '' : ` on the ${sc} rows`
  if (b) d.say(n ? `🌱 ${n.toLocaleString()} × ${sel.value.name}${where}; ${b.n} spots skipped, inside other crowns` : `No room for ${sel.value.name}${where}: all ${b.n} spots are inside other crowns. Fill anyway, or clear some plants first.`, 6000)
  else if (n) d.say(`🌱 ${n.toLocaleString()} × ${sel.value.name}${where}`)
  else d.say('Nothing to plant: lay out rows first.')
}

// ── recipe / consortium ──
function addStep(sp: LibSpecies) {
  if (steps.value.some((s) => s.speciesId === sp.id) && recipeMode.value === 'layers') return d.say(`${sp.name} is already in the recipe.`)
  steps.value = [...steps.value, { speciesId: sp.id, spacing: d.spacingOf(sp), rows: 'all' }]
  d.ui.recipe = true
}
function toggleGoal(g: Goal) {
  const i = goals.value.indexOf(g)
  if (i >= 0) goals.value = goals.value.filter((x) => x !== g)
  else goals.value = goals.value.length < 2 ? [...goals.value, g] : [goals.value[0]!, g]
}
// "Suggest a design": the engine's goal scoring over the species that fit this address, as an editable recipe
function suggest() {
  if (!d.site.value) return d.say('Still reading the climate here. Try again in a moment.')
  const sg = suggestDesign(d.site.value, goals.value, d.areaM2.value, d.imperial.value)
  if (!sg || !sg.plants.length) return d.say('Nothing in the library fits this climate and those goals well enough to suggest.')
  suggestion.value = sg
  steps.value = sg.plants.map((p) => ({ speciesId: p.sp.id, spacing: p.spacing, rows: p.rows, group: p.group }))
  recipeMode.value = 'mix'
  d.ui.recipe = true
}
const spacingDiffers = computed(() => !!suggestion.value && Math.abs(suggestion.value.rowSpacing - d.plot.rowSpacing) > 0.4)
function useSuggestedSpacing() {
  if (!suggestion.value) return
  d.setRowSpacing(suggestion.value.rowSpacing)
  d.say(`Rows set to ${fmtDist(suggestion.value.rowSpacing, d.imperial.value)} for this design.`)
}
function plantRecipe() {
  d.applyRecipe(steps.value, scope.value, recipeMode.value)
}
// keep spacings in step with Target / Design RS
watch(d.fillMode, () => (steps.value = steps.value.map((s) => ({ ...s, spacing: d.spacingOf(libById.get(s.speciesId)!) }))))
const inDesign = computed(() => d.inUse.value.slice().sort((a, b) => CODES.indexOf(a.code) - CODES.indexOf(b.code)))

// ── the support layer ──
const supCands = computed(() => supportCandidates(d.site.value))
const supRatio = computed(() => {
  const crops = d.plot.plants.length - d.supportCount.value
  return crops ? d.supportCount.value / crops : 0
})
function openSupport() {
  d.ensureSupportPicks()
  d.ui.support = !d.ui.support
}
watch(d.site, () => d.ensureSupportPicks())
const DENSITIES = Object.keys(DENSITY) as Density[]
</script>

<template>
  <div class="plant-panel">
    <p class="step">Step 3 of 3</p>
    <h2>Plant your forest</h2>

    <div class="seg tools-seg" role="group" aria-label="Map tool">
      <button class="chip" :class="{ on: d.tool.value === 'place' }" :disabled="!sel" @click="d.setTool('place')">✦ Place</button>
      <button class="chip" :class="{ on: d.tool.value === 'fillrow' }" :disabled="!sel" @click="d.setTool('fillrow')">👆 Fill a row</button>
      <button class="chip" :class="{ on: d.tool.value === 'erase' }" @click="d.setTool('erase')">⌫ Erase</button>
      <button class="chip" :class="{ on: d.tool.value === 'pan' }" @click="d.setTool('pan')">✋ Look</button>
    </div>

    <!-- the chosen plant: everything the Codex says about spacing it, and the ways to plant it -->
    <Transition name="pop">
      <div v-if="sel" class="chosen" :style="{ '--accent': STRATA[sel.code].wash }">
        <header>
          <span class="badge sm">{{ sel.emoji }}</span>
          <span class="goal-text">
            <b>{{ sel.name }}</b>
            <small><i>{{ sel.latin }}</i> · {{ STRATA[sel.code].name }} · {{ sel.lifecycle }}</small>
          </span>
          <button class="chip tiny" title="The full Codex card" @click="d.ui.card = sel.id">ⓘ Card</button>
        </header>
        <p v-if="selFit?.why" class="fit" :class="selFit.level">{{ dot(sel) }} {{ selFit.why }}</p>
        <p v-if="sel.ban" class="ban">⚠️ {{ sel.ban }}</p>
        <div class="rs">
          <button :class="{ on: d.fillMode.value === 'target' }" @click="d.fillMode.value = 'target'"><small>Target RS</small><b>{{ fmtRange(sel.targetRS, d.imperial.value) }}</b><em>as a crop</em></button>
          <button :class="{ on: d.fillMode.value === 'design' }" @click="d.fillMode.value = 'design'"><small>Design RS</small><b>{{ fmtRange(sel.designRS, d.imperial.value) }}</b><em>overplant ×2</em></button>
        </div>
        <label class="canopy-ed" :title="'How wide you manage this crown in this design. Saved with the design, and read from / written to Byron\'s files as canopyOverrides.'">
          <span>Canopy Ø in this design</span>
          <input :value="toUnit(sel.widthM, d.imperial.value)" class="field num" type="number" min="0.1" :step="d.imperial.value ? 1 : 0.5" @change="d.setSpeciesCanopy(sel.id, fromUnit(+($event.target as HTMLInputElement).value, d.imperial.value))">
          <span class="unit">{{ lenUnit(d.imperial.value) }}</span>
          <button v-if="d.canopy[sel.id] !== undefined" class="chip tiny" :title="`Back to the Codex width (${fmtLen(codexWidthOf(sel), d.imperial.value)})`" @click="d.setSpeciesCanopy(sel.id, null)">↺ Codex {{ fmtLen(codexWidthOf(sel), d.imperial.value) }}</button>
        </label>
        <div class="presets">
          <button class="chip tiny" @click="fill('all')">⫶ Fill every row</button>
          <button class="chip tiny" @click="fill('A')">A rows</button>
          <button class="chip tiny" @click="fill('B')">B rows</button>
          <button class="chip tiny" @click="addStep(sel)">＋ Recipe</button>
          <button v-if="d.lastBlocked.value?.sid === sel.id" class="chip tiny warn" title="Plant the skipped spots too; the crowns will overlap" @click="fill(d.lastBlocked.value!.scope, true)">⚠ Fill anyway (+{{ d.lastBlocked.value.n }})</button>
          <button v-if="d.counts.value.get(sel.id)" class="chip tiny" @click="d.clearSpecies(sel.id)">✕ Remove all {{ d.counts.value.get(sel.id) }}</button>
        </div>
        <p class="fine tight">{{ d.tool.value === 'fillrow' ? 'Tap any row to fill it.' : 'Tap the map to place one (it snaps to the nearest row).' }}</p>
      </div>
    </Transition>

    <!-- a row recipe: Byron's pattern tool, made one tap -->
    <div class="recipe" :class="{ open: d.ui.recipe }">
      <button class="recipe-head" @click="d.ui.recipe = !d.ui.recipe">
        <span>🧺 Row recipe <small v-if="steps.length">· {{ steps.length }} plants</small></span>
        <span>{{ d.ui.recipe ? '▾' : '▸' }}</span>
      </button>
      <div v-if="d.ui.recipe" class="recipe-body">
        <div class="suggest">
          <p class="sg-h">✨ Suggest a design <small>for {{ d.site.value ? `zone ${d.site.value.zoneLabel}` : 'here' }}</small></p>
          <p class="fine tight">Pick one or two goals, most important first. We choose species that fit your climate and land.</p>
          <div class="goal-chips">
            <button v-for="g in GOALS" :key="g.id" class="chip tiny" :class="{ on: goals.includes(g.id) }" :title="g.sub" @click="toggleGoal(g.id)">{{ g.emoji }} {{ g.title }}<b v-if="goals.includes(g.id)" class="rank">{{ goals.indexOf(g.id) + 1 }}</b></button>
          </div>
          <button class="btn wide gap-top" :disabled="!goals.length" @click="suggest">{{ suggestion ? '↻ Suggest again' : 'Suggest from my goals' }}</button>
          <div v-if="suggestion" class="sg-result">
            <p class="sg-name"><b>{{ suggestion.name }}</b><small>{{ suggestion.tagline }}</small></p>
            <details open class="why">
              <summary>Why this design</summary>
              <ul><li v-for="(n, i) in suggestion.notes" :key="i">{{ n }}</li></ul>
            </details>
            <div class="presets">
              <button v-if="spacingDiffers" class="chip tiny" @click="useSuggestedSpacing">↔ Set rows to {{ fmtDist(suggestion.rowSpacing, d.imperial.value) }}</button>
              <button v-if="suggestion.contour && d.rowMode.value === 'straight'" class="chip tiny" @click="d.setRowMode('keyline')">〰 Follow the slope</button>
            </div>
          </div>
        </div>
        <ul class="frows">
          <li v-for="(st, i) in steps" :key="i" :style="{ '--accent': STRATA[libById.get(st.speciesId)!.code].wash }">
            <span class="fe">{{ libById.get(st.speciesId)!.emoji }}</span>
            <span class="fi"><b>{{ libById.get(st.speciesId)!.name }}</b><small>{{ st.group ? GROUP_NAME[st.group] : STRATA[libById.get(st.speciesId)!.code].name }}</small></span>
            <select v-if="recipeMode === 'layers'" v-model="st.rows" class="field mini" :aria-label="`Rows for ${libById.get(st.speciesId)!.name}`">
              <option value="all">all rows</option>
              <option value="A">A rows</option>
              <option value="B">B rows</option>
            </select>
            <input :value="toUnit(st.spacing, d.imperial.value)" class="field num" type="number" min="0.1" :step="d.imperial.value ? 0.5 : 0.1" :aria-label="`Spacing for ${libById.get(st.speciesId)!.name}`" :title="d.imperial.value ? 'Feet between plants' : 'Metres between plants'" @change="st.spacing = Math.max(0.1, fromUnit(+($event.target as HTMLInputElement).value, d.imperial.value))">
            <span class="unit">{{ lenUnit(d.imperial.value) }}</span>
            <button class="rb minus" :aria-label="`Remove ${libById.get(st.speciesId)!.name}`" @click="steps.splice(i, 1)">−</button>
          </li>
          <li v-if="!steps.length" class="empty">Choose goals above for a suggested design, or pick plants below and tap ＋ Recipe.</li>
        </ul>
        <template v-if="steps.length">
          <div class="seg">
            <button class="chip tiny" :class="{ on: recipeMode === 'mix' }" title="Species in the same layer take turns along the row, like a syntropic consortium" @click="recipeMode = 'mix'">Mixed layers</button>
            <button class="chip tiny" :class="{ on: recipeMode === 'layers' }" title="Each plant fills its rows at its own spacing, stacked by strata" @click="recipeMode = 'layers'">Layered</button>
            <button class="chip tiny" :class="{ on: recipeMode === 'sequence' }" title="One after another along the row, each followed by its gap, repeating" @click="recipeMode = 'sequence'">In sequence</button>
            <select v-model="scope" class="field mini" aria-label="Which rows">
              <option value="all">all rows</option>
              <option value="A">A rows</option>
              <option value="B">B rows</option>
            </select>
          </div>
          <button class="btn btn-primary wide gap-top" @click="plantRecipe">🌱 Plant the recipe</button>
          <p class="fine tight">{{ recipeMode === 'mix' ? 'Species in each layer take turns along the row at the layer\'s average spacing: tall layers first, no crown planted inside another.' : recipeMode === 'layers' ? 'Each plant fills its rows at its own spacing, so emergent, high, medium and low share the line. A and B rows alternate across the land.' : 'Plant, gap, next plant, gap… repeated down the row.' }}</p>
        </template>
      </div>
    </div>

    <!-- the support layer: nitrogen, biomass and pioneer species between and beside the crops -->
    <div class="recipe support" :class="{ open: d.ui.support }">
      <button class="recipe-head" @click="openSupport">
        <span>🌿 Support layer <small v-if="d.supportCount.value">· {{ d.supportCount.value.toLocaleString() }} plants</small></span>
        <span>{{ d.ui.support ? '▾' : '▸' }}</span>
      </button>
      <div v-if="d.ui.support" class="recipe-body">
        <p class="fine tight">In a syntropic system the crops are carried by support plants at every stratum: nitrogen fixers, biomass and pioneers, planted densely between the crops and pruned hard to feed them. Picked here for {{ d.site.value ? `zone ${d.site.value.zoneLabel}` : 'your site' }}.</p>
        <ul class="frows sup-picks">
          <li v-for="c in CODES" :key="c" :style="{ '--accent': STRATA[c].wash }">
            <span class="fe">{{ d.supportCfg.picks[c] ? libById.get(d.supportCfg.picks[c]!)?.emoji : '·' }}</span>
            <span class="fi"><b>{{ STRATA[c].name }}</b><small>{{ supCands[c].length ? `${supCands[c].length} option${supCands[c].length > 1 ? 's' : ''}` : 'none suit here' }}</small></span>
            <select v-model="d.supportCfg.picks[c]" class="field mini" :aria-label="`${STRATA[c].name} support species`" :disabled="!supCands[c].length">
              <option :value="null">— none —</option>
              <option v-for="sp in supCands[c]" :key="sp.id" :value="sp.id">{{ sp.name }}{{ sp.roles.includes('nfix') ? ' · N' : '' }}{{ sp.invasive ? ' ⚠' : '' }}{{ d.fits.value.get(sp.id)?.level === 'edge' ? ' 🟡' : '' }}</option>
            </select>
          </li>
        </ul>
        <div class="seg">
          <button v-for="k in DENSITIES" :key="k" class="chip tiny" :class="{ on: d.supportCfg.density === k }" :title="DENSITY[k].sub" @click="d.supportCfg.density = k">{{ DENSITY[k].label }}</button>
        </div>
        <label class="optin"><input v-model="d.supportCfg.between" type="checkbox"> Also plant support hedgerows down the middle of each alley</label>
        <button class="btn btn-primary wide gap-top" :disabled="!d.plot.rows.length" @click="d.plantSupport()">🌿 {{ d.supportCount.value ? 'Replant' : 'Plant' }} the support layer</button>
        <div v-if="d.supportCount.value" class="presets">
          <button class="chip tiny" :class="{ on: !d.ui.showSupport }" @click="d.ui.showSupport = !d.ui.showSupport">{{ d.ui.showSupport ? '🙈 Hide support' : '👁 Show support' }}</button>
          <button class="chip tiny" @click="d.clearSupport()">✕ Clear support</button>
        </div>
        <p class="fine tight">
          <template v-if="d.supportCount.value">{{ d.supportCount.value.toLocaleString() }} support plants<template v-if="supRatio"> · {{ supRatio.toFixed(1) }} per crop plant</template>. </template>
          Plant your crops first: support fills the gaps around them, standing closer than crops would (it's kept pruned), and is thinned out as the canopy closes. N = fixes nitrogen · ⚠ = can be invasive.
        </p>
      </div>
    </div>

    <!-- the library -->
    <input v-model="q" class="field search" type="search" placeholder="Search 160 Codex species…" aria-label="Search species">
    <div class="filters">
      <button v-for="c in CODES" :key="c" class="chip tiny" :class="{ on: strata === c }" :style="{ '--chip': STRATA[c].wash }" @click="strata = strata === c ? null : c">{{ c }} · {{ STRATA[c].name }}</button>
      <button class="chip tiny" :class="{ on: kind === 'food' }" @click="kind = kind === 'food' ? 'all' : 'food'">🍎 Food</button>
      <button class="chip tiny" :class="{ on: kind === 'support' }" @click="kind = kind === 'support' ? 'all' : 'support'">🌱 Support</button>
    </div>
    <div class="splist">
      <section v-for="g in grouped" :key="g.c">
        <h4 :style="{ color: STRATA[g.c].color }">{{ g.c }} · {{ STRATA[g.c].name }} <small>{{ STRATA[g.c].share }}</small></h4>
        <button v-for="sp in g.items" :key="sp.id" class="spi" :class="{ sel: d.selSpId.value === sp.id }" :style="{ '--accent': STRATA[sp.code].wash }" @click="pick(sp)">
          <span class="fe">{{ sp.emoji }}</span>
          <span class="fi">
            <b>{{ sp.name }}<small v-if="d.counts.value.get(sp.id)" class="count"> ×{{ d.counts.value.get(sp.id) }}</small><small v-if="d.canopy[sp.id] !== undefined" class="count" title="Canopy width edited for this design"> ●</small></b>
            <small>{{ fmtLen(sp.heightM, d.imperial.value) }} × {{ fmtLen(sp.widthM, d.imperial.value) }} · every {{ fmtSpan(sp.targetRS[0], sp.targetRS[1], d.imperial.value) }} · {{ LIFECYCLE[sp.lifecycle].label.split(' · ')[0] }}</small>
          </span>
          <span class="fitdot" :title="d.fits.value.get(sp.id)?.why">{{ dot(sp) }}</span>
        </button>
      </section>
      <p v-if="!grouped.length" class="empty">{{ q ? 'Nothing by that name in the Codex.' : 'Nothing in this group grows here.' }}</p>
    </div>
    <button v-if="!q && hidden" class="linkish" @click="d.ui.showAll = !d.ui.showAll">{{ d.ui.showAll ? 'Hide' : 'Show' }} {{ hidden }} species that won't grow here</button>

    <template v-if="inDesign.length">
      <h3>Canopy check</h3>
      <div class="canopy-check">
        <div v-for="c in CODES" :key="c" class="cc" :class="{ over: d.canopyShare.value[c] > OCCUPANCY[c] * 1.15 }" :title="`${STRATA[c].name} crowns cover ${Math.round(d.canopyShare.value[c] * 100)}% of your land; the Codex aims for about ${OCCUPANCY[c] * 100}%`">
          <span class="cc-l">{{ c }}</span>
          <span class="cc-bar"><i :style="{ width: Math.min(100, d.canopyShare.value[c] * 100) + '%', background: STRATA[c].wash, borderColor: STRATA[c].color }" /><b :style="{ left: OCCUPANCY[c] * 100 + '%' }" /></span>
          <span class="cc-v">{{ Math.round(d.canopyShare.value[c] * 100) }}%</span>
        </div>
      </div>
      <p class="fine tight">Bar = how much of your land each layer's mature crop crowns cover (the pruned support layer isn't counted). Tick = the Codex target (20 / 40 / 60 / 80%). Over it, layers shade each other: prune harder, widen spacing, or use fewer rows.</p>
      <h3>In your design</h3>
      <ul class="frows">
        <li v-for="sp in inDesign" :key="sp.id" :style="{ '--accent': STRATA[sp.code].wash }">
          <span class="fe">{{ sp.emoji }}</span>
          <span class="fi"><b>{{ sp.name }}</b><small>{{ STRATA[sp.code].name }} · ×{{ d.counts.value.get(sp.id)?.toLocaleString() }}<template v-if="d.fits.value.get(sp.id)?.level === 'no'"> · ⚠️ won't thrive here</template></small></span>
          <button class="rb minus" :aria-label="`Remove all ${sp.name}`" @click="d.clearSpecies(sp.id)">−</button>
        </li>
      </ul>
    </template>
  </div>
</template>
