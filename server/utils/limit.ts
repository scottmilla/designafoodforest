import type { H3Event } from 'h3'

// A small per-visitor rate limit for the two API routes, so one person (or bot) can't burn through the free
// geocoding and weather services we proxy. It lives in memory, so on Vercel each warm function instance keeps its
// own counts: good enough to stop abuse, not a hard guarantee. For a real limit put Vercel's Firewall rate limiting
// or an Upstash Redis counter in front (see MAINTENANCE.md).
const hits = new Map<string, { n: number; reset: number }>()

export function rateLimit(event: H3Event, bucket: string, max = 30, windowMs = 60_000) {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const h = hits.get(key)
  if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs })
  else if (++h.n > max) throw createError({ statusCode: 429, statusMessage: 'Slow down a little: too many requests. Try again in a minute.' })
  // keep the map from growing without bound
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
}
