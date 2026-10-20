import type { Code, LibSpecies, Site } from '#shared/types'
import { bestCards, fitFor } from './library'

// The support layer. In a syntropic system the target crops are only part of the planting: every consortium is
// carried by support species (nitrogen fixers, biomass plants, fast pioneers) at each stratum, planted densely
// between the crops and pruned hard to feed the soil and push the crops to grow. Byron's v13 designer placed target
// crops only; this picks the support species for the site and lays them into the gaps and alleys.

export type Density = 'light' | 'standard' | 'dense'
export const DENSITY: Record<Density, { label: string; k: number; sub: string }> = {
  light: { label: 'Light', k: 1.6, sub: 'a support plant for every crop or so' },
  standard: { label: 'Standard', k: 1, sub: 'the Codex Design RS: about two support plants per crop' },
  dense: { label: 'Dense', k: 0.65, sub: 'syntropic establishment: three or more per crop, thinned as the canopy closes' },
}
export interface SupportCfg { picks: Record<Code, string | null>; density: Density; between: boolean }

const has = (sp: LibSpecies, r: string) => sp.roles.includes(r)
const DANGER = /ricin|lethal/i
// a plant whose job here would be support: it fixes nitrogen, makes biomass, takes a pollard or is tagged support
export const isSupportish = (sp: LibSpecies) => sp.support || has(sp, 'nfix') || has(sp, 'biomass') || sp.pollard

// How good a support plant is for this site. Pure support beats dual-purpose crops; nitrogen and biomass count most.
export function supportScore(sp: LibSpecies, site: Site | null) {
  const fit = fitFor(sp, site)
  if (fit.level === 'no' || DANGER.test(sp.ban ?? '')) return -Infinity
  return (fit.level === 'good' ? 2 : 0)
    + (has(sp, 'nfix') ? 1.6 : 0) + (has(sp, 'biomass') ? 1 : 0) + (sp.pollard ? 0.9 : 0) + (sp.support ? 0.5 : 0)
    + (site && sp.natives.includes(site.region) ? 0.6 : 0)
    - (sp.food ? 0.4 : 0) - (sp.invasive ? 3 : 0) - (sp.ban ? 0.5 : 0)
}

// the support species that could serve each stratum at this site, best first
export function supportCandidates(site: Site | null) {
  const out: Record<Code, LibSpecies[]> = { E: [], H: [], M: [], L: [] }
  for (const sp of bestCards(site)) {
    if (!isSupportish(sp)) continue
    const s = supportScore(sp, site)
    if (s > -Infinity) out[sp.code].push(sp)
  }
  for (const c of Object.keys(out) as Code[]) out[c].sort((a, b) => supportScore(b, site) - supportScore(a, site) || a.name.localeCompare(b.name))
  return out
}

// the default picks: the best non-invasive support for each stratum (none where nothing suits)
export function defaultPicks(site: Site | null): Record<Code, string | null> {
  const c = supportCandidates(site)
  const best = (code: Code) => c[code].find((sp) => !sp.invasive && supportScore(sp, site) > 1)?.id ?? null
  return { E: best('E'), H: best('H'), M: best('M'), L: best('L') }
}

// metres between support plants of one species: the Codex Design RS (its overplanting density), scaled by the
// chosen density, never so tight that a design runs to hundreds of thousands of plants
export function supportGap(sp: LibSpecies, density: Density) {
  const mid = (sp.designRS[0] + sp.designRS[1]) / 2
  return Math.max(sp.form === 'herb' ? 0.6 : 1.2, mid * DENSITY[density].k)
}
