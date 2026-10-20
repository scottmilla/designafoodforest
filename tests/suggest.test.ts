import { describe, expect, it } from 'vitest'
import type { Site } from '../shared/types'
import { fitFor } from '../app/utils/library'
import { GOALS, suggestDesign } from '../app/utils/suggest'
import { hasLibrary } from './privateLibrary'

const site = (over: Partial<Site> = {}): Site => ({
  label: 'Test', country: 'US', lat: 38.5, lon: -75.8, region: 'na-east', zone: 8, zoneLabel: '8a', climate: 'temperate', minTempC: -12, meanTempC: 14,
  precipMm: 1200, frostFreeDays: 230, chillHours: 1400, dryMonths: 0, hemisphere: 'N', ...over,
})

describe.skipIf(!hasLibrary)('suggest a design (the engine, ported)', () => {
  it('only suggests species that can grow at the address', () => {
    for (const g of GOALS) {
      const sg = suggestDesign(site(), [g.id], 20000)!
      expect(sg.plants.length).toBeGreaterThan(3)
      for (const p of sg.plants) expect(fitFor(p.sp, site()).level, `${g.id}: ${p.sp.id}`).not.toBe('no')
    }
  })
  it('stacks strata for a year-round design and plants something that pays early', () => {
    const sg = suggestDesign(site(), ['yearRound'], 20000)!
    const codes = new Set(sg.plants.filter((p) => p.group !== 'S').map((p) => p.sp.code))
    expect(['H', 'M', 'L'].every((c) => codes.has(c as 'H'))).toBe(true)
    expect(sg.plants.some((p) => p.sp.food && (p.sp.yearsToFruit || 9) <= 2)).toBe(true)
    // tall layers alternate rows so the canopy stays open
    expect(sg.plants.filter((p) => p.group === 'E').every((p) => p.rows === 'A')).toBe(true)
    expect(sg.plants.filter((p) => p.group === 'H').every((p) => p.rows === 'B')).toBe(true)
  })
  it('keeps the money design small and wide, with a pollarded support tree', () => {
    const sg = suggestDesign(site(), ['money'], 20000)!
    expect(sg.plants.filter((p) => p.sp.food && !['B', 'G'].includes(p.group)).length).toBeLessThanOrEqual(2)
    expect(sg.rowSpacing).toBeGreaterThanOrEqual(8)
    expect(sg.plants.some((p) => p.group === 'S')).toBe(true)
  })
  it('natives means natives', () => {
    const sg = suggestDesign(site(), ['natives'], 20000)!
    for (const p of sg.plants) expect(p.sp.natives).toContain('na-east')
  })
  it('is deterministic, and a second goal shifts the picks', () => {
    const a = suggestDesign(site(), ['yearRound'], 8000)!.plants.map((p) => p.sp.id)
    expect(suggestDesign(site(), ['yearRound'], 8000)!.plants.map((p) => p.sp.id)).toEqual(a)
    const b = suggestDesign(site(), ['yearRound', 'natives'], 8000)!.plants.map((p) => p.sp.id)
    expect(b).not.toEqual(a)
  })
  it('drops the emergent layer on a backyard and never suggests the dangerous ones', () => {
    const sg = suggestDesign(site(), ['yearRound'], 500)!
    expect(sg.plants.some((p) => p.group === 'E')).toBe(false)
    expect(suggestDesign(site({ zone: 11, climate: 'tropical', minTempC: 12 }), ['restoration'], 20000)!.plants.some((p) => /castor/i.test(p.sp.name))).toBe(false)
  })
  it('returns nothing without a goal', () => {
    expect(suggestDesign(site(), [], 1000)).toBeNull()
  })
})
