import type { LibSpecies } from '#shared/types'

type GrowthSpec = Pick<LibSpecies, 'form' | 'heightM' | 'layer' | 'pollard' | 'succession' | 'lifespanYears' | 'lifecycle' | 'food'>

// Managed thinning, by role. Nurse trees (support species, pioneers) are cut out as the canopy closes: by year 10
// most are gone, which is what they were planted for. Crop trees are thinned only lightly (to give the rest room to
// fruit), and the survivors' crowns widen to fill the gaps, so the stand ends up dense and mature, not sparse.
// Long-lived emergents (climax trees in the top layer, e.g. pecan, oak) are the system's permanent canopy and are
// never thinned. Plants are chosen for thinning in a regular, staggered order (see `rank` in useDesign's scene), never at random.
type ThinSpec = Pick<LibSpecies, 'succession' | 'food' | 'form' | 'layer'>
const ramp = (year: number, from: number, to: number, max: number) => max * Math.min(1, Math.max(0, (year - from) / (to - from)))
export const isPermanentEmergent = (sp: Pick<LibSpecies, 'succession' | 'layer'>) => sp.layer === 'emergent' && sp.succession === 'climax'

export function thinnedShare(sp: ThinSpec, year: number) {
  if (sp.form === 'herb') return 0 // the herb and ground layer is renewed in place and stays
  if (isPermanentEmergent(sp)) return 0
  if (!sp.food) return sp.succession === 'climax' ? ramp(year, 5, 20, 0.5) : ramp(year, 2, 10, 0.75)
  return sp.succession === 'secondary' ? ramp(year, 3, 12, 0.25) : sp.succession === 'climax' ? ramp(year, 6, 25, 0.25) : 0
}

// How far (0..1) a crown has spread from its managed width toward its natural spread. Most crowns widen as their
// neighbours are thinned; permanent emergents widen anyway as they rise above the canopy and are let go.
export function crownRelease(sp: ThinSpec, year: number) {
  if (isPermanentEmergent(sp)) return ramp(year, 6, 25, 1)
  return Math.min(1, thinnedShare(sp, year) / 0.25)
}

// How big a plant is in a given year of the system (0..1 of mature size).
// `rank` (0..1, stable per plant, regularly spread) decides which individuals are thinned first.
export function plantGrowth(sp: GrowthSpec, year: number, rank = 1) {
  // short-lived pioneers finish; everything else persists (orchards are replanted in place, herbs and shrubs renewed),
  // so a mature design doesn't go bald when a species' *productive* life ends. That ending shows in the harvest chart.
  if (sp.succession === 'placenta' && sp.form !== 'herb' && sp.form !== 'shrub' && year > sp.lifespanYears + 0.5) return 0
  if (rank < thinnedShare(sp, year)) return 0
  return Math.min(1, Math.max(0.1, 0.1 + 0.9 * Math.pow(Math.min(1, year / matureAge(sp)), 0.85)))
}

// Years to full size: set by the Codex lifecycle first (placenta crops are up in a season or two, climax trees
// take decades), then by form and layer.
export function matureAge(sp: Pick<LibSpecies, 'form' | 'heightM' | 'layer' | 'pollard' | 'lifecycle'>) {
  if (sp.form === 'herb') return 1
  if (sp.pollard) return 3
  if (sp.form === 'palm') return sp.heightM > 8 ? 12 : 1.5
  if (sp.lifecycle === 'Short') return 2
  if (sp.lifecycle === 'Short-Medium') return 4
  if (sp.lifecycle === 'Short-Perennial') return 5
  if (sp.form === 'shrub') return 4
  if (sp.lifecycle === 'Medium') return 8
  return { emergent: 20, high: 12, medium: 9, low: 6, ground: 2 }[sp.layer]
}

// How far up the trunk the crown has lifted (0..1 of its full lift) at a given growth: young trees are crown to the
// ground, mature managed trees are limbed up so the layers below get light.
export const crownLift = (g: number) => Math.pow(g, 1.4)

export function monthsIn(h?: [number, number]) {
  if (!h) return [] as number[]
  const out: number[] = []
  for (let m = h[0], i = 0; i < 12; i++) {
    out.push(m)
    if (m === h[1]) break
    m = (m % 12) + 1
  }
  return out
}
