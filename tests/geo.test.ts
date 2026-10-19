import { describe, expect, it } from 'vitest'
import { frameAt, keylineRows, nearestRow, pathSampler, polyAreaM2, rowAB, rowPath, straightRows } from '../app/utils/geo'

// a 100 m × 50 m field (east × north) near Castro Valley
const o = { lat: 37.694, lng: -122.073 }
const F = frameAt(o)
const field = [F.toLL(0, 0), F.toLL(100, 0), F.toLL(100, 50), F.toLL(0, 50)]

describe('land and rows', () => {
  it('measures the land', () => {
    expect(polyAreaM2(field)).toBeCloseTo(5000, -1)
  })
  it('fills it with straight rows, centred, clipped to the boundary', () => {
    const rows = straightRows(field, 0, 5) // east–west rows, 5 m apart
    expect(rows.length).toBe(10)
    for (const r of rows) expect(pathSampler(rowPath(r)).total).toBeCloseTo(100, 0)
    expect(rows.map(rowAB).join('')).toBe('ABABABABAB')
  })
  it('snaps a point to the nearest row', () => {
    const rows = straightRows(field, 0, 5)
    const hit = nearestRow(rows, F.toLL(40, 3.1), 2.5)
    expect(hit).not.toBeNull()
    expect(F.toM(hit!.ll.lat, hit!.ll.lng).y).toBeCloseTo(2.5, 1)
  })
  it('offsets a bent keyline until the land is covered', () => {
    const key = [F.toLL(-10, 20), F.toLL(50, 30), F.toLL(110, 18)]
    const { rows } = keylineRows(field, key, 5)
    expect(rows.length).toBeGreaterThanOrEqual(10)
    // every row stays inside the field
    for (const r of rows) for (const p of r.path) {
      const m = F.toM(p.lat, p.lng)
      expect(m.x).toBeGreaterThan(-0.01)
      expect(m.x).toBeLessThan(100.01)
      expect(m.y).toBeGreaterThan(-0.01)
      expect(m.y).toBeLessThan(50.01)
    }
  })
})
