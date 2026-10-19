import { describe, expect, it } from 'vitest'
import type { Site } from '../shared/types'
import { fitFor, fromByron, libById, LIBRARY, toByron, yieldAt, yieldDefaults } from '../app/utils/library'

const site = (zone: number, climate: Site['climate'], minTempC: number, chillHours = 800): Site => ({
  label: 'Test', country: 'US', lat: 38, lon: -77, region: 'na-east', zone, zoneLabel: String(zone), climate, minTempC, meanTempC: 13,
  precipMm: 1000, frostFreeDays: 200, chillHours, dryMonths: 0, hemisphere: 'N',
})

describe('species library (Codex VOL2_4 + species model)', () => {
  it('has every data card, each with Codex spacing', () => {
    expect(LIBRARY.length).toBe(169)
    for (const sp of LIBRARY) {
      expect(sp.targetRS[0]).toBeGreaterThan(0)
      expect(sp.designRS[1]).toBeLessThanOrEqual(sp.targetRS[1])
      expect(sp.widthM).toBeGreaterThan(0)
    }
  })
  it('reads the cards as written', () => {
    const walnut = libById.get('walnut-e')!
    expect([walnut.heightM, walnut.widthM]).toEqual([20, 14])
    expect(walnut.targetRS).toEqual([10, 15])
    expect(walnut.designRS).toEqual([5, 7.5])
    expect(walnut.note).toMatch(/juglone/i)
    expect(libById.get('date-palm-e')!.frostKillC).toBe(-8)
    // the Matrix's "20×14m" biomass notation is not the plant (Codex Section 5)
    expect(libById.get('sorrel-l')!.widthM).toBe(0.3)
    // "dwarf … to standard": the standard tree
    expect(libById.get('pomegranate-l')!.widthM).toBe(4)
  })
  it("maps to and from Byron's designer ids", () => {
    expect(toByron.get('walnut-e')).toBe('sp_walnut_e')
    expect(toByron.get('feijoa-l-2')).toBe('sp_feijoa_l_2')
    expect(fromByron.get('sp_a_a_e')).toBe('acai-e') // his sanitiser drops the accented letters
    expect(new Set(toByron.values()).size).toBe(LIBRARY.length)
  })
})

describe('will it grow here', () => {
  it('honours the Codex frost bans', () => {
    expect(fitFor(libById.get('date-palm-e')!, site(7, 'temperate', -17)).level).toBe('no')
    expect(fitFor(libById.get('ice-cream-bean-e')!, site(9, 'subtropical', -4)).level).toBe('no')
  })
  it('uses hardiness zones where the species model knows them', () => {
    expect(fitFor(libById.get('apple-h')!, site(6, 'temperate', -21)).level).toBe('good')
    expect(fitFor(libById.get('mango-h')!, site(6, 'temperate', -21)).level).toBe('no')
    expect(fitFor(libById.get('apple-h')!, site(11, 'tropical', 12, 0)).level).toBe('no') // no winter chill
  })
})

describe('production curve', () => {
  it('ramps to a peak, plateaus, then declines', () => {
    const c = { first: 3, peak: 6, end: 30, perPlant: 50, price: 2 }
    expect(yieldAt(c, 2)).toBe(0)
    expect(yieldAt(c, 3)).toBeGreaterThan(0)
    expect(yieldAt(c, 10)).toBe(50)
    expect(yieldAt(c, 31)).toBe(0)
  })
  it('estimates food plants without model yields from canopy area', () => {
    const y = yieldDefaults(libById.get('japanese-raisin-e')!)
    expect(y.perPlant).toBeGreaterThan(0)
  })
})

describe('genus cards', () => {
  it('offers hardy citrus in zone 8a as an edge fit, and plain citrus where it is easy', () => {
    const citrus = libById.get('citrus-m')!
    expect(fitFor(citrus, site(8, 'temperate', -12)).level).toBe('edge')
    expect(fitFor(citrus, site(8, 'temperate', -12)).why).toMatch(/yuzu/)
    expect(fitFor(citrus, site(10, 'mediterranean', -2, 400)).level).toBe('good')
    expect(fitFor(citrus, site(6, 'temperate', -21)).level).toBe('no')
  })
})
