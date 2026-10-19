import type { Weather } from '../../shared/types'

// Right-now conditions at a point (Open-Meteo). Returns null if the service is unreachable.
export async function weatherFor(lat: number, lon: number): Promise<Weather | null> {
  try {
    const r = await $fetch<any>('https://api.open-meteo.com/v1/forecast', {
      query: { latitude: lat, longitude: lon, current: 'temperature_2m,weather_code,is_day,cloud_cover,wind_speed_10m', daily: 'sunrise,sunset', timezone: 'auto', forecast_days: 1 },
      timeout: 8000,
    })
    return {
      tempC: r.current.temperature_2m, code: r.current.weather_code, isDay: !!r.current.is_day, cloud: r.current.cloud_cover, wind: r.current.wind_speed_10m,
      localTime: r.current.time, utcOffsetSeconds: r.utc_offset_seconds, sunrise: r.daily.sunrise[0], sunset: r.daily.sunset[0],
    }
  } catch {
    return null
  }
}
