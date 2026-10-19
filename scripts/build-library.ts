// Builds shared/library.json: every Codex data card (Byron Austin's Food-Forestry Codex VOL2_4, in
// data/SPECIES_DATA_LIBRARY.md) joined with our species model (data/pff-species.ts) for the things the
// cards don't carry: hardiness zones, yields, harvest months, prices, leaf/fruit colour and plant form.
//
//   node scripts/build-library.ts      (Node 24+ runs TypeScript directly)
//
// Re-run it whenever either source changes. Spacing, dimensions, soil, pruning and hard bans always come
// from the Codex; the species model only fills gaps.
import { readFileSync, writeFileSync } from 'node:fs'
import { SPECIES, type Species } from '../data/pff-species.ts'
import type { Code, CodexClimate, Form, LibSpecies, Lifecycle, Strata, Succession } from '../shared/types.ts'

const md = readFileSync(new URL('../data/SPECIES_DATA_LIBRARY.md', import.meta.url), 'utf8')
const byId = new Map(SPECIES.map((s) => [s.id, s]))

// Codex name → species-model id. "look:" borrows only colour and form (a different species that looks
// alike); a bare id also borrows zones, yield and harvest.
const MATCH: Record<string, string> = {
  'Walnut': 'english-walnut', 'Japanese Raisin': 'look:basswood', 'Cherry': 'wild-cherry', 'Pine Nut': 'look:pinyon', 'Date Palm': 'date-palm',
  'Ice Cream Bean': 'inga', 'Parana Nut / Araucaria': 'look:araucaria', 'Jelly Palm': 'look:date-palm', 'Açaí': 'look:coconut', 'Cashew': 'cashew',
  'Mahogany': 'mahogany', 'Pecan': 'pecan', 'Chestnut': 'sweet-chestnut', 'Pear': 'pear', 'Jussara': 'look:coconut', 'Marang': 'look:breadfruit',
  'Durian': 'look:jackfruit', 'Black Locust': 'black-locust', 'Poplar': 'hybrid-poplar', 'Russian Olive / Elaeagnus': 'look:autumn-olive',
  'Black Wattle': 'acacia', 'Casuarina': 'look:white-pine', 'Castor Oil': 'look:papaya', 'Eucalyptus': 'eucalyptus', 'Silver Wattle': 'acacia',
  'Moringa': 'moringa', 'Guanacaste': 'guanacaste', 'Jacaranda': 'look:redbud', 'Chinaberry / White Cedar': 'look:neem', 'Tobacco': 'look:comfrey',
  'Papaya': 'papaya', 'Rainbow Eucalyptus': 'look:eucalyptus', 'Birch': 'look:tulip-poplar', 'Pine': 'white-pine',
  'Apple': 'apple', 'Mulberry': 'mulberry', 'Kiwi': 'hardy-kiwi', 'Carob': 'carob', 'Almond': 'almond', 'Fig': 'fig', 'Avocado': 'avocado',
  'White Sapote': 'white-sapote', 'Macadamia': 'macadamia', 'Jackfruit': 'jackfruit', 'Mangosteen': 'look:mamey', 'Mango': 'mango',
  'American Paw Paw': 'pawpaw', 'Olive': 'olive', 'Loquat': 'loquat', 'Grape': 'grape', 'Sea Buckthorn': 'sea-buckthorn', 'Canistel / Egg Fruit': 'look:mamey',
  'Lychee': 'lychee', 'Sapodilla': 'look:mamey', 'Black Sapote': 'black-sapote', 'Dwarf Coconut': 'look:breadfruit', 'Passionfruit': 'passionfruit',
  'Highland Papaya': 'look:papaya', 'Banana Cavendish / Lady Finger': 'banana', 'Banana Lady Finger': 'banana', 'Dragonfruit': 'dragonfruit',
  'Rocoto Chili': 'look:goumi', 'Willow': 'look:hybrid-poplar', 'Strawberry': 'strawberry', 'Globe Artichoke': 'look:comfrey', 'Jerusalem Artichoke': 'look:comfrey',
  'Plum': 'plum', 'Quince': 'quince', 'Hazelnut': 'hazelnut', 'Citrus': 'citrus', 'Persimmon': 'asian-persimmon', 'Lentisk / Pistacia': 'look:pistachio',
  'Cherimoya': 'cherimoya', 'Finger Lime': 'finger-lime', 'Sugar Apple': 'look:cherimoya', 'Longan': 'longan', 'Barbados Cherry / Acerola': 'acerola', 'Acerola': 'acerola',
  'Cacao': 'cacao', 'Peach': 'peach', 'Nectarine': 'peach', 'Apricot': 'look:peach', 'Tropical Guava': 'guava', 'Surinam Cherry': 'surinam-cherry',
  'Cherry Guava': 'look:guava', 'Naranjilla / Lulo': 'look:goumi', 'Cupuaçu': 'look:cacao', 'Starfruit / Carambola': 'look:guava', 'Grumichama': 'look:surinam-cherry',
  'Tamarillo': 'look:papaya', 'Soursop': 'soursop', 'Granadilla': 'look:passionfruit', 'Feijoa': 'feijoa', 'Blueberry': 'blueberry', 'Blackcurrant': 'currant',
  'Rosemary': 'rosemary', 'Pomegranate': 'pomegranate', 'Sage': 'sage', 'Monstera': 'look:banana-hardy', 'Jaboticaba': 'jaboticaba', 'Coffee': 'coffee',
  'Tea': 'look:coffee', 'Black Pepper': 'look:passionfruit', 'Comfrey': 'comfrey', 'French Sorrel': 'look:sorrel', 'Japanese Wineberry': 'look:raspberry',
  'Gooseberry': 'currant', 'Strawberry Tree': 'look:loquat', 'Currant': 'currant', 'Aloe Vera': 'look:lemongrass', 'Cardamom': 'look:ginger', 'Vanilla': 'look:passionfruit',
  'Snake Fruit / Salak': 'look:date-palm', 'Elderberry': 'elderberry', 'Alder': 'alder', 'Sugarcane': 'look:vetiver', 'Mexican Sunflower': 'look:comfrey',
  'Tree Lucerne / Tagasaste': 'tree-lucerne', 'Pineapple Sage': 'look:sage', 'Myoga Ginger': 'look:ginger', 'Miracle Fruit': 'look:surinam-cherry',
  'Peanutbutter Fruit': 'look:surinam-cherry', 'Curry Leaf Tree': 'look:neem', 'Biriba / Rollinia': 'look:cherimoya', 'Stinging Nettle': 'look:comfrey',
  'Yacon': 'look:comfrey', 'Cape Gooseberry': 'look:goumi', 'Kale': 'look:comfrey', 'Cassava': 'cassava', 'Rambutan': 'look:lychee',
  'Oregano': 'oregano', 'Artemisia': 'look:sage', 'Prickly Pear': 'prickly-pear', 'Lemon Verbena': 'look:lemon-balm', 'Blackberry': 'blackberry',
  'Raspberry': 'raspberry', 'Ginger': 'ginger', 'Pineapple': 'pineapple', 'Okinawa Spinach': 'look:comfrey', 'Sorrel': 'look:sorrel',
  'Sweet Potato': 'sweet-potato', 'Taro': 'look:banana-hardy', 'Water Spinach': 'look:mint', 'NZ Spinach': 'look:mint', 'Coca': 'look:coffee',
  'Borage': 'borage', 'Clover': 'clover', 'Lavender': 'lavender', 'Marjoram': 'look:oregano', 'Nasturtium': 'look:calendula', 'Thyme': 'thyme',
  'Alpine Strawberry': 'strawberry', 'Mint': 'mint', 'Hosta': 'look:comfrey', 'Turmeric': 'ginger',
}

// emoji for species the model doesn't know (or knows only by look)
const EMOJI: [RegExp, string][] = [
  [/palm|açaí|jussara|salak|coconut/i, '🌴'], [/banana/i, '🍌'], [/coffee/i, '☕'], [/tea$/i, '🍵'], [/pine(?!apple)|araucaria|casuarina/i, '🌲'],
  [/chili|rocoto/i, '🌶️'], [/kiwi/i, '🥝'], [/grape/i, '🍇'], [/pear$/i, '🍐'], [/apple/i, '🍎'], [/cherry/i, '🍒'], [/peach|nectarine|apricot/i, '🍑'],
  [/citrus|lime|lemon/i, '🍋'], [/mango/i, '🥭'], [/strawberry/i, '🍓'], [/blue|currant|elder|berry/i, '🫐'], [/nut|almond|cashew|pecan|walnut|chestnut|hazel|macadamia/i, '🌰'],
  [/avocado/i, '🥑'], [/pineapple/i, '🍍'], [/olive/i, '🫒'], [/ginger|turmeric|cardamom/i, '🫚'], [/potato|yacon|cassava|taro|artichoke/i, '🥔'],
  [/kale|spinach|sorrel|nettle|hosta/i, '🥬'], [/sunflower|tithonia|nasturtium|borage/i, '🌼'], [/jacaranda/i, '🪻'], [/vanilla|pepper/i, '🌿'],
  [/dragon|prickly/i, '🌵'], [/sugarcane/i, '🎋'], [/eucalyptus|locust|wattle|poplar|willow|birch|alder|mahogany|guanacaste|chinaberry|lucerne/i, '🌳'],
]

// A Codex card can stand for a whole genus whose hardiest members grow far colder than the typical one.
// zMin takes the hardy end; zEdge (+ note) is where the typical type starts to be fine.
const HARDY_END: Record<string, { zMin: number; zEdge: number; note: string }> = {
  'Citrus': { zMin: 7.5, zEdge: 9.5, note: 'grow only the hardy types (yuzu, satsuma, calamondin), ideally on trifoliate rootstock' },
}

// The species model's price is meant as direct-to-customer USD per kg; a few are closer to wholesale. Corrections:
const PRICE_FIX: Record<string, number> = { 'Citrus': 6 } // ~$2.70/lb direct (the model had $3/kg ≈ $1.36/lb, a wholesale figure)

// grown for biomass, nitrogen, shelter or timber, whatever their cards say about leaves or pods
const NOT_FOOD = new Set(['Tobacco', 'Castor Oil', 'Black Locust', 'Poplar', 'Willow', 'Birch', 'Alder', 'Eucalyptus', 'Rainbow Eucalyptus', 'Casuarina',
  'Black Wattle', 'Silver Wattle', 'Mahogany', 'Guanacaste', 'Jacaranda', 'Chinaberry / White Cedar', 'Clover', 'Comfrey', 'Mexican Sunflower',
  'Tree Lucerne / Tagasaste', 'Sugarcane', 'Hosta', 'Pine', 'Russian Olive / Elaeagnus'])

// ── parse ──
const num = (s: string) => parseFloat(s)
const range = (s: string | undefined): [number, number] | null => {
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:[–—-]+\s*(\d+(?:\.\d+)?))?\s*m/)
  return m ? [num(m[1]!), num(m[2] ?? m[1]!)] : null
}
const tags = (s: string) => [...s.matchAll(/\[([A-Za-z-]+)\]/g)].map((m) => m[1]!)
const field = (blk: string, label: string) => blk.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`))?.[1]?.trim() ?? ''
const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim()

function normLC(s: string): Lifecycle {
  const l = s.trim().toLowerCase()
  if (l.startsWith('short-p')) return 'Short-Perennial'
  if (l.startsWith('short-m')) return 'Short-Medium'
  if (l.startsWith('short')) return 'Short'
  if (l.startsWith('medium')) return 'Medium'
  return 'Long'
}

// Fixes the card text can't express cleanly (dimension notation, multiple spacing contexts).
const FIX: Record<string, Partial<{ h: number; w: number; t: [number, number] }>> = {
  'Cardamom': { t: [2, 3] }, // Matrix's 8–12 m is the biomass row alternative (Section 5)
}

const out: LibSpecies[] = []
const seen = new Map<string, number>()
const unmatched: string[] = []

for (const blk of md.split(/(?=^### )/m)) {
  if (!blk.startsWith('###') || !blk.includes('**Strata:**')) continue
  const hm = blk.match(/^### ([^|*\n[]+)(?:\s*\|\s*\*([^*\n]+)\*)?/m)
  if (!hm) continue
  const rawName = hm[1]!.trim()
  const name = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (!name || /^(EMERGENT|HIGH|MEDIUM|LOW|SECTION)/.test(name)) continue
  const latin = (hm[2] ?? '').trim()
  const strataRaw = field(blk, 'Strata')
  const code = strataRaw.match(/^([EHML])/)?.[1] as Code | undefined
  if (!code) continue
  const lcLine = field(blk, 'Lifecycle')
  const lifecycle = normLC(lcLine)
  const phase = strip(lcLine.split('**Phase:**')[1] ?? '').replace(/^\|\s*/, '')
  const climateRaw = field(blk, 'Climate')
  const climates = [...new Set(climateRaw.split(/[,/]/).map((c) => c.replace(/\(.*?\)/g, '').trim()).filter((c): c is CodexClimate => ['Temperate', 'Mediterranean', 'Subtropical', 'Tropical'].includes(c)))]

  const dimLine = field(blk, 'Dimensions')
  const dims = strip(dimLine.split('**Target RS:**')[0]!.replace(/\|\s*$/, ''))
  // "20×14m [… standard Sorrel dimensions: 0.3×0.3m]" — the bracketed figure is the plant; 20×14 is the Matrix's biomass notation
  const std = dims.match(/standard[^:\]]*dimensions:\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/i)
  // "1.5×0.6m (espalier) to 6×5m (standard)": take the standard form, else the last size listed
  const pairs = [...dims.matchAll(/(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*m?\s*(\([^)]*\))?/g)]
  const many = pairs.length > 1 && /\bto\b/.test(dims)
  const hw = std ?? (many ? pairs.find((p) => /standard/i.test(p[3] ?? '')) ?? pairs.at(-1) : pairs[0])
  let h = hw ? num(hw[1]!) : 3
  let w = hw ? num(hw[2]!) : 3
  // Target RS: prefer the "(standard)" context where a card lists several
  const tLine = (dimLine.split('**Target RS:**')[1] ?? '').split('**Design RS:**')[0]!
  const tStd = tLine.match(/([\d.]+\s*[–—-]+\s*[\d.]+\s*m)\s*\(standard\)/)
  // "[… standard Nectarine Target RS = 4–6m]": the bracketed standard figure wins over the Matrix notation
  const tNote = tLine.match(/\[[^\]]*standard[^\]]*?(\d+(?:\.\d+)?\s*[–—-]+\s*\d+(?:\.\d+)?\s*m)/i)
  let t = range(tStd?.[1] ?? tNote?.[1] ?? tLine) ?? [Math.max(w, 0.5), Math.max(w, 0.5)]
  const dLine = dimLine.split('**Design RS:**')[1] ?? ''
  const dStd = dLine.match(/([\d.]+\s*[–—-]+\s*[\d.]+\s*m)\s*\(standard\)/)
  let d = range(dStd?.[1] ?? dLine) ?? [t[0] / 2, t[1] / 2]
  const fix = FIX[name]
  if (fix?.t) { t = fix.t; d = [fix.t[0] / 2, fix.t[1] / 2] }
  // (Codex Section 5): only where the card itself says so (unmanaged / biomass / potential / host…) or the
  // plant's own spacing is far tighter than a 14 m crown could be
  if (/^20\s*[×x]\s*14/.test(dims) && !std && (/unmanaged|biomass|potential|can extend|can reach|notation|host|umbrella|stand/i.test(dims) || t[1] < 4)) {
    // the Matrix's "20×14m" biomass/host notation, not the plant: size the canopy from its own spacing
    w = Math.min(w, Math.max(0.3, t[1]))
    h = Math.min(h, Math.max(0.4, w * 1.5))
  } else if (w > t[1] * 3 && t[1] <= 2) {
    // a stand footprint or cane spread far wider than the plant's own spacing (kale, wineberry, coppiced willow)
    w = t[1] * 1.5
    h = Math.min(h, Math.max(w, 1))
  }
  if (fix?.h) h = fix.h
  if (fix?.w) w = fix.w

  const soil = strip(field(blk, 'Soil'))
  const pruning = strip(field(blk, 'Pruning'))
  const creditFull = strip(field(blk, 'Succession Credit'))
  const creditLevel = creditFull.match(/^([A-Za-z-]+(?:\s*[–-]\s*[A-Za-z]+)?)/)?.[1] ?? 'Moderate'
  const note = strip(field(blk, 'Technical Note'))
  const banM = blk.match(/⚠️?\s*(?:ABSOLUTE\s+)?HARD BAN:?\s*([^\n]*)/)
  const ban = banM ? strip(banM[1]!).replace(/^[:\s]+/, '') : null
  let frostKillC: number | null = null
  if (ban && /frost/i.test(ban)) {
    const below = ban.match(/below\s*(-?\d+(?:\.\d+)?)\s*°C/i)
    frostKillC = below ? num(below[1]!) : 0
  }
  const hardy = `${note} ${creditFull} ${soil}`.match(/(?:hardy to|tolerant to|to)\s*(-\d+(?:\.\d+)?)\s*°C/i)
  const hardyC = hardy ? num(hardy[1]!) : null

  // ── join ──
  const key = MATCH[name] ?? MATCH[name.split(' (')[0]!] ?? ''
  const lookOnly = key.startsWith('look:')
  const ref: Species | undefined = byId.get(key.replace('look:', ''))
  if (!ref) unmatched.push(name)
  const real = ref && !lookOnly ? ref : undefined

  const lcTiming: Record<Lifecycle, [number, number]> = { 'Short': [1, 2], 'Short-Medium': [1, 4], 'Short-Perennial': [1, 14], 'Medium': [3, 22], 'Long': [6, 55] }
  const succession: Succession = lifecycle === 'Short' ? 'placenta' : lifecycle === 'Long' ? 'climax' : 'secondary'
  const layer: Strata = code === 'E' ? 'emergent' : code === 'H' ? 'high' : code === 'M' ? 'medium' : h < 0.9 ? 'ground' : 'low'
  const supportish = /n[- ]?fix|biomass|pioneer|windbreak|chop/i.test(creditFull + ' ' + pruning) || pruning.includes('[Chop-Drop]')
  const foodRoles = ['fruit', 'berry', 'nut', 'staple', 'herb']
  const food = real ? real.kg > 0 && real.roles.some((r) => foodRoles.includes(r)) : /edible|fruit|nut|cone|harvest|crop|leaf|tuber|spice|berr|market|yield/i.test(creditFull + ' ' + note) && !NOT_FOOD.has(name)
  let form: Form = ref?.form ?? (code === 'L' ? (h < 0.9 ? 'herb' : 'shrub') : 'round')
  if (/palm|açaí|jussara/i.test(name) && !/sage/i.test(name)) form = 'palm'
  if (/grape|kiwi|passion|granadilla|vanilla|pepper|dragon/i.test(name)) form = 'vine'

  const pruningTags = tags(pruning)
  const sp: LibSpecies = {
    id: '',
    name, latin, code,
    strataNote: strataRaw.length > 1 ? strataRaw.slice(1).replace(/^[\s(]+|\)$/g, '').trim() || undefined : undefined,
    lifecycle, phase, climates, climateRaw,
    heightM: Math.round(h * 100) / 100, widthM: Math.round(w * 100) / 100, dims,
    targetRS: t, designRS: d,
    soil, soilTags: tags(soil), pruning, pruningTags,
    credit: creditFull, creditLevel, note, ban, frostKillC, hardyC,
    emoji: (real ?? ref)?.emoji && !lookOnly ? ref!.emoji : EMOJI.find(([re]) => re.test(name))?.[1] ?? ref?.emoji ?? (code === 'L' ? '🌿' : '🌳'),
    form,
    leaf: ref?.leaf ?? '#5aa64a',
    fruit: food ? ref?.fruit ?? '#e8a33a' : undefined,
    deciduous: ref?.dec ?? !climates.some((c) => c === 'Tropical' || c === 'Subtropical'),
    yearsToFruit: food ? real?.ytf || lcTiming[lifecycle][0] : 0,
    // the species model's yield is for its own (often larger, unmanaged) canopy: scale to the Codex size
    yieldKg: real ? Math.round(real.kg * Math.min(1, (w / Math.max(real.w, 0.1)) ** 2) * 10) / 10 : 0,
    harvest: real?.harvest,
    pricePerKg: PRICE_FIX[name] ?? real?.price,
    zMin: HARDY_END[name]?.zMin ?? real?.zMin, zMax: real?.zMax, chill: real?.chill,
    zEdge: HARDY_END[name]?.zEdge, zEdgeNote: HARDY_END[name]?.note,
    food, support: !food || supportish,
    roles: real ? [...real.roles] : food ? ['fruit'] : ['support'],
    natives: real?.natives ?? [],
    rare: !!real?.rare,
    dry: !!real?.dry,
    invasive: !!real?.invasive || /INVASIVE:|declared (a )?(major )?(weed|invasive)|invasive species|declared invasive/i.test((ban ?? '') + ' ' + note + ' ' + blk),
    uses: real?.uses ? [...real.uses] : [],
    varietyWindows: real?.varieties?.map((v) => v.harvest) ?? [],
    layer, succession,
    lifespanYears: real?.life ?? lcTiming[lifecycle][1],
    pollard: pruningTags.includes('Pollard') || (pruningTags.includes('Coppice') && !food),
  }
  // ids: name + strata, with the climate as a suffix for the Codex's per-climate duplicates
  const base = `${name}-${code}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  sp.id = n === 1 ? base : `${base}-${n}`
  out.push(sp)
}

writeFileSync(new URL('../shared/library.json', import.meta.url), JSON.stringify(out))
console.log(`${out.length} cards → shared/library.json`)
if (unmatched.length) console.log(`no species-model match (Codex data + defaults only): ${[...new Set(unmatched)].join(', ')}`)
