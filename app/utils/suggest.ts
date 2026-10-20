import type { Code, LibSpecies, Site } from '#shared/types'
import { bestCards, fitFor, yieldDefaults } from './library'
import { fmtDist } from './fmt'

// "Suggest a design": the goal-scoring design engine from plantafoodforest (server/model/engine.ts, "Syntropic
// Sage"), ported to run in the browser over the Codex library, and aimed at the land the person drew instead of an
// invented rectangle. Same idea, transparent rules rather than a model:
//   1. keep the species that fit this address (Codex frost bans, zones, chill, climate)
//   2. score each against the ranked goals
//   3. fill each stratum's pool by score (or by harvest-calendar coverage for the year-round and rare goals)
//   4. add support species, a herb layer and ground cover
// It returns a recipe (species, which rows, how far apart) plus the reasons. The recipe is then laid on the real
// rows by `applyRecipe` in useDesign.ts, whose crown-clearance rules decide exactly where each plant goes.

export type Goal = 'money' | 'yearRound' | 'natives' | 'restoration' | 'rare' | 'timber'
export const GOALS: { id: Goal; emoji: string; title: string; sub: string }[] = [
  { id: 'money', emoji: '💰', title: 'Money', sub: 'Pays from season 2, fewer crops done well' },
  { id: 'yearRound', emoji: '🧺', title: 'Year-round fruit', sub: 'Something ripe every month' },
  { id: 'natives', emoji: '🪶', title: 'Natives', sub: 'Plants that belong to this land' },
  { id: 'restoration', emoji: '🦋', title: 'Restoration', sub: 'Wildlife, water, soil-building' },
  { id: 'rare', emoji: '🍋', title: 'Rare & edge-of-zone', sub: 'Collector fruit, pushing the zone' },
  { id: 'timber', emoji: '🪵', title: 'Timber', sub: 'Fast nurses training hardwoods' },
]
const NAMES: Record<Goal, { name: string; tagline: string }> = {
  money: { name: 'Market Alley', tagline: 'A few money crops, wide alleys, pollarded support trees.' },
  yearRound: { name: 'Twelve-Month Larder', tagline: 'Staggered crops so something ripens every season.' },
  natives: { name: 'Native Tapestry', tagline: 'Plants that belong here, woven through every stratum.' },
  restoration: { name: 'Living Watershed', tagline: 'Built for wildlife, water and soil.' },
  rare: { name: 'Edge of the Zone', tagline: 'Collector fruit and marginal hardies, stacked for a long season.' },
  timber: { name: 'Timber Succession', tagline: 'Fast support species training slow hardwoods straight and tall.' },
}
// metres between rows that suit each goal (Market Alley is sized from its crop tree below)
const ROW_SPACING: Record<Goal, number> = { money: 8, yearRound: 4.5, rare: 4.5, natives: 5, restoration: 6, timber: 6 }

// A recipe line's group decides how species share the rows: members of a group take turns along the row.
export type Group = 'E' | 'H' | 'S' | 'M' | 'L' | 'B' | 'G'
export const GROUP_ORDER: Group[] = ['E', 'H', 'S', 'M', 'L', 'B', 'G']
export const GROUP_NAME: Record<Group, string> = { E: 'Emergent', H: 'High', S: 'Support', M: 'Medium', L: 'Low', B: 'Herb layer', G: 'Ground cover' }

export interface SuggestedPlant { sp: LibSpecies; group: Group; rows: 'all' | 'A' | 'B'; spacing: number; why: string }
export interface Suggestion {
  goals: Goal[]
  name: string
  tagline: string
  plants: SuggestedPlant[]
  notes: string[]
  rowSpacing: number
  contour: boolean // slope-following rows would suit this goal
}

type Weights = Partial<Record<Goal, number>>
interface Cand { sp: LibSpecies; native: boolean; edge: boolean; dry: number; kg: number; ytf: number; price: number }

const has = (sp: LibSpecies, role: string) => sp.roles.includes(role)
const isSupportOnly = (sp: LibSpecies) => !sp.food && (has(sp, 'support') || has(sp, 'nfix') || has(sp, 'biomass') || sp.pollard) && !has(sp, 'timber')
const isHerb = (sp: LibSpecies) => sp.form === 'herb' && has(sp, 'herb')
const isGround = (sp: LibSpecies) => sp.form === 'herb' && !has(sp, 'herb')

const mid = (r: [number, number]) => (r[0] + r[1]) / 2
const shiftM = (m: number, south: boolean) => (south ? ((m + 5) % 12) + 1 : m)
const monthsOf = (h: [number, number], south: boolean) => {
  const out: number[] = []
  for (let m = h[0], i = 0; i < 12; i++) {
    out.push(shiftM(m, south))
    if (m === h[1]) break
    m = (m % 12) + 1
  }
  return out
}
const seasonOf = (c: Cand, south: boolean) => {
  const ws = c.sp.varietyWindows.length ? c.sp.varietyWindows : c.sp.harvest ? [c.sp.harvest] : []
  return new Set(ws.flatMap((w) => monthsOf(w, south)))
}

// ── 1. who can grow here ──
function candidates(site: Site): Cand[] {
  const dry = site.climate === 'arid' || site.dryMonths >= 5
  return bestCards(site).flatMap((sp) => {
    const fit = fitFor(sp, site)
    if (fit.level === 'no') return []
    if (/ricin|lethal/i.test(sp.ban ?? '')) return [] // never suggest the dangerous ones
    const d = yieldDefaults(sp)
    return [{ sp, native: sp.natives.includes(site.region), edge: fit.level === 'edge', dry: dry && !sp.dry ? 0.6 : 0, kg: sp.yieldKg || d.perPlant, ytf: sp.yearsToFruit || d.first, price: sp.pricePerKg ?? 4 }]
  })
}

// ── 2. goal scoring (the engine's rules) ──
function goalScore(c: Cand, g: Goal): number {
  const sp = c.sp
  const value = sp.food ? Math.log1p(c.price * c.kg) : 0
  switch (g) {
    case 'money': return sp.food ? value / (1 + c.ytf * 0.2) + (c.ytf <= 3 ? 0.6 : 0) - (sp.rare ? 0.8 : 0) : 0
    case 'yearRound': return sp.food ? 1.6 + value * 0.25 + (has(sp, 'fruit') || has(sp, 'berry') ? 0.6 : 0) : 0
    case 'natives': return c.native ? 3 : -2
    case 'restoration': return (c.native ? 1.6 : 0) + (has(sp, 'wildlife') ? 1 : 0) + (has(sp, 'flower') ? 0.6 : 0) + (has(sp, 'nfix') ? 0.8 : 0) + (has(sp, 'biomass') ? 0.4 : 0) + (sp.invasive ? 0.3 : 0) + (sp.food ? 0.5 : 0)
    case 'rare': return sp.food ? 0.8 + (sp.rare ? 1.6 : 0) + (c.edge ? 1.8 : 0) + value * 0.15 : 0
    case 'timber': return (has(sp, 'timber') ? 2.5 : 0) + (has(sp, 'nut') ? 0.4 : 0) + (has(sp, 'support') ? 0.4 : 0)
  }
}
function score(c: Cand, w: Weights) {
  let t = 0
  for (const [g, wt] of Object.entries(w) as [Goal, number][]) t += wt * goalScore(c, g)
  if (c.edge && !(w.rare && w.rare >= 0.5)) t -= 1.2 // marginal species are a gamble unless the person asked for them
  if (c.sp.invasive && !w.restoration) t -= 1.5
  if (c.sp.ban && !c.sp.invasive) t -= 0.4 // has a hard-ban condition to check: slightly behind the unconditional picks
  return t - c.dry
}

// ── 3. pools ──
function pickPool(cands: Cand[], k: number, w: Weights, mode: 'score' | 'season', south: boolean, covered = new Set<number>()) {
  const ranked = cands.map((c) => ({ c, sc: score(c, w) })).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc)
  if (mode === 'score') return ranked.slice(0, k).map((r) => r.c)
  // season mode: prefer species that ripen in months nothing else already covers
  const out: Cand[] = []
  const left = [...ranked]
  while (out.length < k && left.length) {
    let best = 0
    let bestVal = -Infinity
    left.forEach((r, i) => {
      const fresh = [...seasonOf(r.c, south)].filter((m) => !covered.has(m)).length
      const v = r.sc * 0.5 + fresh * 0.7
      if (v > bestVal) { bestVal = v; best = i }
    })
    const [r] = left.splice(best, 1)
    out.push(r!.c)
    seasonOf(r!.c, south).forEach((m) => covered.add(m))
  }
  return out
}

function allowedLayers(site: Site, area: number, goal: Goal): Code[] {
  let s: Code[]
  if (site.climate === 'tropical' || site.zone >= 10.5) s = ['E', 'H', 'M', 'L']
  else if (site.zone >= 8.5) s = area >= 4000 ? ['E', 'H', 'M', 'L'] : ['H', 'M', 'L']
  else if (site.zone >= 6) s = area >= 8000 ? ['E', 'H', 'M', 'L'] : ['H', 'M', 'L']
  else s = area >= 4000 ? ['H', 'M', 'L'] : ['M', 'L']
  if ((goal === 'timber' || goal === 'natives' || goal === 'restoration') && !s.includes('E')) s = ['E', ...s]
  if (area < 800) s = s.filter((x) => x !== 'E') // a backyard has no room for an emergent
  return s
}

function herbScore(c: Cand, w: Weights) {
  const u = c.sp.uses
  return 1
    + (c.native ? 0.3 + 2 * (w.natives ?? 0) : 0)
    + (u.includes('culinary') ? 0.7 * (w.yearRound ?? 0) : 0)
    + (w.restoration ? (has(c.sp, 'wildlife') ? 0.6 : 0) + (u.includes('pollinator') ? 0.4 : 0) : 0)
    + (w.money ? Math.log1p(c.price * c.kg) * 0.5 : 0)
    + (w.rare && !c.native ? 0.2 : 0)
    - (c.edge && !((w.rare ?? 0) >= 0.5) ? 1.2 : 0)
    - (c.sp.invasive && !w.restoration ? 2 : 0)
    - c.dry
}
// the best herbs for the goals, spread across uses (a kitchen herb, a tea, a medicinal, a pollinator…) rather than five mints
function pickHerbs(cands: Cand[], k: number, w: Weights) {
  const out: Cand[] = []
  const used = new Set<string>()
  const left = cands.filter((c) => herbScore(c, w) > 0)
  while (out.length < k && left.length) {
    let best = 0
    let bestVal = -Infinity
    left.forEach((c, i) => {
      const v = herbScore(c, w) + c.sp.uses.filter((u) => !used.has(u)).length * 0.6
      if (v > bestVal) { bestVal = v; best = i }
    })
    const [c] = left.splice(best, 1)
    out.push(c!)
    c!.sp.uses.forEach((u) => used.add(u))
  }
  return out
}

export function suggestDesign(site: Site, goals: Goal[], areaM2: number, imperial = false): Suggestion | null {
  if (!goals.length) return null
  const [g1, g2] = goals as [Goal, Goal | undefined]
  const w: Weights = { [g1]: 1, ...(g2 ? { [g2]: 0.5 } : {}) }
  const south = site.hemisphere === 'S'
  const area = areaM2 || 4000
  const all = candidates(site)
  const natives = (w.natives ?? 0) >= 1
  const pool = natives ? all.filter((c) => c.native) : all
  const layers = allowedLayers(site, area, g1)
  const notes: string[] = []
  const plants: SuggestedPlant[] = []
  const add = (list: Cand[], group: Group, rows: SuggestedPlant['rows'], why: (c: Cand) => string) => {
    const spacings = list.map((c) => Math.max(0.3, mid(c.sp.targetRS)))
    // species that share a group take turns along the row, so the group's step is their average spacing
    const mean = spacings.reduce((a, b) => a + b, 0) / (spacings.length || 1)
    // the herb and ground layers are dense: a plant every metre or so, across the bed, not one per Codex spacing
    // nurse trees are sparse: one every 8 m or more, on alternate rows, so they feed the soil without crowding out the crops
    const step = group === 'B' ? Math.max(0.9, mean) : group === 'G' ? Math.max(0.7, mean * 0.8) : group === 'S' ? Math.max(8, mean * 2.5) : mean
    for (const c of list) plants.push({ sp: c.sp, group, rows, spacing: Math.round(step * 10) / 10, why: why(c) })
  }
  const support = pool
    .filter((c) => isSupportOnly(c.sp) && layers.includes(c.sp.code) && (g1 !== 'money' || c.sp.pollard))
    .sort((a, b) => supportScore(b, w) - supportScore(a, w))
    .slice(0, g1 === 'money' ? 1 : 2)
  const food = pool.filter((c) => c.sp.food && !isHerb(c.sp))
  const trees = (code: Code) => pool.filter((c) => c.sp.code === code && !isSupportOnly(c.sp) && c.sp.form !== 'herb')

  let rowSpacing = ROW_SPACING[g1]
  if (g1 === 'money') {
    // Market Alley: one target tree and one berry done well, pollarded support between them
    const tree = pickPool(food.filter((c) => (c.sp.code === 'M' || c.sp.code === 'H') && c.ytf <= 5 && c.sp.form !== 'vine' && c.sp.form !== 'shrub' && !c.sp.pollard && c.sp.succession !== 'placenta'), 1, w, 'score', south)
    const berry = pickPool(food.filter((c) => (c.sp.code === 'L' || c.sp.code === 'M') && c.ytf <= 3 && has(c.sp, 'berry') && c.sp.id !== tree[0]?.sp.id), 1, w, 'score', south)
    add(tree, tree[0]?.sp.code ?? 'M', 'all', (c) => `target crop, first harvest ~year ${c.ytf}`)
    add(berry, 'L', 'all', (c) => `early berry carrying the system from year ${c.ytf}`)
    add(support, 'S', 'all', () => 'pollarded between the crop trees: nitrogen and mulch without shading the money')
    if (tree[0]) rowSpacing = Math.min(12, Math.max(8, tree[0].sp.widthM + 4.5))
    notes.push(`${tree[0]?.sp.name ?? 'A tree crop'} is the target crop${berry[0] ? `, carried by ${berry[0].sp.name} from year ${berry[0].ytf}` : ''}.`)
    notes.push(`Rows ${fmtDist(Math.round(rowSpacing), imperial)} apart so a compact tractor and mower fit down every alley.`)
  } else {
    const base = g1 === 'yearRound' || g1 === 'rare' ? { E: 2, H: 4, M: 6, L: 5 } : g1 === 'natives' ? { E: 3, H: 3, M: 4, L: 4 } : g1 === 'timber' ? { E: 3, H: 2, M: 2, L: 2 } : { E: 2, H: 3, M: 4, L: 4 }
    // a small plot can't carry as many species as a farm: fewer per layer, never fewer than one or two
    const scale = area < 800 ? 0.5 : area < 4000 ? 0.7 : 1
    const k = Object.fromEntries((Object.keys(base) as Code[]).map((c) => [c, Math.max(c === 'E' ? 1 : 2, Math.round(base[c] * scale))])) as Record<Code, number>
    const mode = g1 === 'yearRound' || g1 === 'rare' ? 'season' : 'score'
    const covered = new Set<number>()
    const picked: Partial<Record<Code, Cand[]>> = {}
    for (const code of ['L', 'M', 'H', 'E'] as Code[]) {
      if (!layers.includes(code)) continue
      const wts: Weights = g1 === 'timber' && (code === 'E' || code === 'H') ? { ...w, timber: 2 } : w
      picked[code] = pickPool(trees(code), k[code], wts, mode, south, covered)
    }
    // something should pay back in years 1–2
    if (g1 !== 'timber') {
      const mixed = Object.values(picked).flat()
      const early = pickPool(food.filter((c) => c.ytf <= 2 && layers.includes(c.sp.code) && c.sp.form !== 'herb' && !mixed.some((p) => p!.sp.id === c.sp.id)), 1, w, 'score', south)
      if (early[0] && !mixed.some((p) => p!.ytf <= 2)) (picked[early[0].sp.code] ??= []).push(early[0])
    }
    const label: Record<Code, string> = { E: 'emergent: the tall canopy, on every other row', H: 'high layer, on the alternate rows', M: 'medium layer', L: 'low layer' }
    for (const code of ['E', 'H', 'M', 'L'] as Code[]) add(picked[code] ?? [], code, code === 'E' ? 'A' : code === 'H' ? 'B' : 'all', () => label[code])
    add(support, 'S', 'A', (c) => (c.sp.pollard ? 'pollarded support' : has(c.sp, 'nfix') ? 'nitrogen-fixing support' : 'biomass support'))
    const strataUsed = (['E', 'H', 'M', 'L'] as Code[]).filter((c) => picked[c]?.length)
    notes.push(`${strataUsed.length} strata stacked (${strataUsed.join(', ')}) for ${Math.abs(site.lat).toFixed(0)}° latitude and ${area >= 4000 ? 'a generous' : 'a small'} plot${strataUsed.length < 4 ? '. Nearer the tropics or on bigger land a row can carry more layers.' : '.'}`)
    if (mode === 'season') {
      const months = new Set(plants.flatMap((p) => (p.group === 'S' ? [] : [...seasonOf({ sp: p.sp } as Cand, south)])))
      notes.push(`Picked to ripen across the calendar: ${months.size} of 12 months have something to harvest.`)
    }
    if (g1 === 'natives') {
      const n = new Set(plants.map((p) => p.sp.id)).size
      notes.push(`${n} species native to your region.${n < 6 ? ' The Codex only lists a few natives for your region, so widen this with local nursery stock.' : ''}`)
    }
    if (g1 === 'rare') {
      const edge = plants.filter((p) => pool.find((c) => c.sp.id === p.sp.id)?.edge).map((p) => p.sp.name)
      if (edge.length) notes.push(`Zone-pushers: ${[...new Set(edge)].slice(0, 5).join(', ')}. Site them on south-facing walls, by water or in the lee of evergreens.`)
    }
    if (g1 === 'timber') {
      const tim = plants.filter((p) => has(p.sp, 'timber')).map((p) => p.sp.name)
      if (tim.length) notes.push(`Hardwoods (${[...new Set(tim)].slice(0, 4).join(', ')}) are trained straight by fast neighbours; thin around year 8.`)
    }
    if (g1 === 'restoration') notes.push('Rows that follow the slope (keyline) suit this goal best: add swales along them to slow and sink the rain.')
  }

  // herb layer and ground cover for every design
  const herbN = Math.max(2, Math.round({ money: 3, yearRound: 7, rare: 7, natives: 6, restoration: 7, timber: 3 }[g1] * (area < 4000 ? 0.7 : 1)))
  const herbs = pickHerbs(pool.filter((c) => isHerb(c.sp)), herbN, w)
  const groundCands = pool.filter((c) => isGround(c.sp))
  const ground = g1 === 'money'
    ? pickPool(groundCands.filter((c) => !c.sp.food), 1, { restoration: 1 }, 'score', south)
    : pickPool(groundCands, g1 === 'timber' ? 2 : 4, { ...w, yearRound: (w.yearRound ?? 0) + 0.3, restoration: (w.restoration ?? 0) + 0.3 }, 'score', south)
  add(herbs, 'B', 'all', (c) => `herb layer: ${c.sp.uses.slice(0, 2).join(' & ') || 'kitchen'}`)
  add(ground, 'G', 'all', () => 'ground cover between the plants')
  if (herbs.length) notes.push(`Herb layer: ${herbs.map((c) => c.sp.name).join(', ')}: kitchen, tea, medicine and pollinator plants filling every gap.`)
  if (support.length) notes.push(`Support species (${support.map((c) => c.sp.name).join(', ')}) are pruned hard to feed the soil and signal the fruit trees to grow.`)
  if (support.some((c) => c.sp.invasive)) notes.push('Includes vigorous pioneers that rebuild soil fast. Check local invasive-species rules first.')
  const edgeUsed = plants.some((p) => pool.find((c) => c.sp.id === p.sp.id)?.edge)
  if (edgeUsed && g1 !== 'rare') notes.push('A few plants are at the cold edge of your zone (marked 🟡 in the library). Give them a sheltered spot.')
  if (areaM2 > 5000) rowSpacing = Math.round(rowSpacing * 1.15 * 2) / 2

  const goalNames = goals.map((g) => NAMES[g].name)
  return {
    goals, name: goals.length > 1 ? `${goalNames[0]} + ${goalNames[1]}` : goalNames[0]!, tagline: NAMES[g1].tagline,
    plants, notes, rowSpacing, contour: g1 === 'restoration',
  }
}

// support trees are judged on their job (nitrogen, biomass, taking a pollard), not on their fruit
function supportScore(c: Cand, w: Weights) {
  return (has(c.sp, 'nfix') ? 1.2 : 0) + (c.sp.pollard ? 1 : 0) + (has(c.sp, 'biomass') ? 0.6 : 0) + (c.native ? 0.5 + (w.natives ?? 0) : 0) - (c.sp.invasive && !w.restoration ? 2 : 0) - c.dry
}
