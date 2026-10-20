import { describe, expect, it } from 'vitest'
import { esriPrecision, houseNumber, parseCoords, simplifyAddress } from '../server/utils/addressText'
import { iso2 } from '../server/utils/iso3'

describe('address text', () => {
  it('drops NZ rural delivery, PO boxes and unit prefixes', () => {
    expect(simplifyAddress('45 Kahikatea Flat Road, RD 3, Albany 0793')).toBe('45 Kahikatea Flat Road, Albany 0793')
    expect(simplifyAddress('12 Kowhai Rd, R.D. 2, Kerikeri')).toBe('12 Kowhai Rd, Kerikeri')
    expect(simplifyAddress('3/12 Foo St, Napier')).toBe('12 Foo St, Napier')
    expect(simplifyAddress('Unit 4, 88 Main St, Boulder, CO')).toBe('88 Main St, Boulder, CO')
    expect(simplifyAddress('PO Box 22, Raglan')).toBe('Raglan')
  })
  it('leaves ordinary addresses alone', () => {
    expect(simplifyAddress('1600 Pennsylvania Ave NW, Washington DC')).toBe('1600 Pennsylvania Ave NW, Washington DC')
    expect(simplifyAddress('Road 12, Rd 5 Farm')).toContain('Road 12')
  })
  it('reads coordinates and house numbers', () => {
    expect(parseCoords('-36.647, 174.639')).toEqual({ lat: -36.647, lon: 174.639 })
    expect(parseCoords('37.694 -122.073')).toEqual({ lat: 37.694, lon: -122.073 })
    expect(parseCoords('12 Main St')).toBeNull()
    expect(houseNumber('45B Kahikatea Flat Road')).toBe('45b')
    expect(houseNumber('Kahikatea Flat Road')).toBeNull()
  })
  it('maps Esri match types and country codes', () => {
    expect(esriPrecision('PointAddress')).toBe('house')
    expect(esriPrecision('StreetName')).toBe('street')
    expect(esriPrecision('Locality')).toBe('town')
    expect(iso2('NZL')).toBe('NZ')
    expect(iso2('USA')).toBe('US')
  })
})
