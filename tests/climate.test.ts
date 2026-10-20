import { describe, expect, it } from 'vitest'
import { frostFreeSeason, summarise, type DailySeries } from '../server/model/climate'

// a run of days with frost (tmin −3 °C) whenever `frosty(date)` says so, otherwise +8 °C
function series(from: string, to: string, frosty: (d: Date) => boolean): DailySeries {
  const out: DailySeries = { time: [], tmin: [], tmax: [], precip: [] }
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
    const d = new Date(t)
    out.time.push(d.toISOString().slice(0, 10))
    out.tmin.push(frosty(d) ? -3 : 8)
    out.tmax.push(15)
    out.precip.push(2)
  }
  return out
}
const md = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate() // 4/20 → 420

describe('frost-free season', () => {
  it('counts from the last spring frost to the first autumn frost (north)', () => {
    // frost up to 20 April and from 15 October: 21 Apr … 14 Oct is 177 days
    const d = series('2015-01-01', '2024-12-31', (x) => md(x) <= 420 || md(x) >= 1015)
    expect(frostFreeSeason(d, false)).toBe(177)
    expect(summarise(d, 40).frostFreeDays).toBe(177)
  })
  it('ignores a mild spell in winter, which the old day-count didn\'t', () => {
    // frost Jan–Apr and Oct–Dec, except a frost-free fortnight in January: the season is still 21 Apr … 14 Oct
    const d = series('2015-01-01', '2024-12-31', (x) => (md(x) <= 420 || md(x) >= 1015) && !(md(x) >= 110 && md(x) <= 124))
    expect(frostFreeSeason(d, false)).toBe(177)
  })
  it('runs July to June in the southern hemisphere', () => {
    // frost from 20 May to 20 September: 21 Sep … 19 May is 241 days
    const d = series('2015-01-01', '2024-12-31', (x) => md(x) >= 520 && md(x) <= 920)
    expect(frostFreeSeason(d, true)).toBe(241)
  })
  it('is the whole year where it never frosts', () => {
    expect(frostFreeSeason(series('2015-01-01', '2024-12-31', () => false), false)).toBe(365)
    expect(frostFreeSeason(series('2015-01-01', '2024-12-31', () => false), true)).toBe(365)
  })
})
