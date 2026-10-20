import type { Precision } from '../../shared/types'

// Pure helpers for reading what people type into the address box. Kept free of Nuxt imports so they can be tested.

// A tidier query for geocoders that choke on postal-only parts of an address:
//   NZ rural delivery ("RD 2", "R.D. 2", "Rural Delivery 2"), PO boxes, unit prefixes ("Unit 3, ", "3/12 Foo St" → "12 Foo St").
export function simplifyAddress(q: string) {
  return q
    .replace(/\b(?:r\.?\s?d\.?|rural\s+delivery)\s*\d+\b,?/gi, '')
    .replace(/\b(?:p\.?\s?o\.?\s+box|private\s+bag)\s+\d+\b,?/gi, '')
    .replace(/(^|,)\s*(?:unit|apt|apartment|suite|ste|flat)\.?\s*#?\s*\d+\w?\s*(?:,|(?=\s\d))/gi, '$1')
    .replace(/(^|\s)\w{1,4}\/(\d+\w?\s)/g, '$1$2')
    .replace(/#\s*\d+\w*/g, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
}

// "37.694, -122.073", "37.694 -122.073", "-36.64,174.63" → numbers; anything else → null
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  return { lat: +m[1]!, lon: +m[2]! }
}

// the house number someone typed, if any: "45 Kahikatea Flat Road" → "45"
export function houseNumber(q: string) {
  return simplifyAddress(q).match(/^\s*(\d+[a-z]?)\b/i)?.[1]?.toLowerCase() ?? null
}

// how close a geocoder's answer is, from Esri's Addr_type
export function esriPrecision(t: string): Precision {
  if (/^(PointAddress|StreetAddress|StreetAddressExt|Subaddress|Parcel)$/.test(t)) return 'house'
  if (/^(StreetName|StreetInt|StreetBetween|StreetMidBlock|DistanceMarker)$/.test(t)) return 'street'
  if (t === 'POI') return 'place'
  if (/^(Locality|Postal|PostalLoc|PostalExt|Neighborhood|District|City|Subregion)$/.test(t)) return 'town'
  return 'region'
}
// and from OpenStreetMap's (Nominatim addresstype / Photon type)
export function osmPrecision(t: string, hasNumber: boolean): Precision {
  if (hasNumber || /^(house|building|address)$/.test(t)) return 'house'
  if (/^(street|road|highway)$/.test(t)) return 'street'
  if (/^(city|town|village|hamlet|suburb|neighbourhood|postcode|locality|municipality|district)$/.test(t)) return 'town'
  if (/^(state|country|county|region)$/.test(t)) return 'region'
  if (/^(amenity|shop|tourism|leisure|farm|farmyard|building|attraction)$/.test(t)) return 'place'
  return 'street'
}
export const PRECISION_RANK: Record<Precision, number> = { house: 0, place: 1, street: 2, town: 3, region: 4 }
