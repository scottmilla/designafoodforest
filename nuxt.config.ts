export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@tresjs/nuxt'],
  ssr: false,
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['leaflet/dist/leaflet.css', '~/assets/css/main.css'],
  vite: {
    // keep a single copy of three across TresJS and our own imports (avoids blank scenes after dep re-optimization)
    resolve: { dedupe: ['three', 'vue'] },
    optimizeDeps: { include: ['three', '@tresjs/core', 'leaflet', 'three/examples/jsm/utils/BufferGeometryUtils.js'] },
  },
  devtools: { enabled: false },
  // Override with NUXT_* env vars (see .env.example). Nothing here is secret: there are no API keys in this app.
  runtimeConfig: {
    contactEmail: '', // NUXT_CONTACT_EMAIL — sent to OpenStreetMap's Nominatim as identification, as its usage policy asks
  },
  // The app is a static single-page app (ssr: false) plus two small server routes. Vercel runs the routes as
  // serverless functions and serves the rest from its CDN; the preset is detected automatically.
  routeRules: {
    '/': { prerender: true }, // the SPA shell is a static file on the CDN, not a function call
    '/api/geocode': { swr: 60 * 60 * 24, headers: { 'cache-control': 'public, max-age=3600' } }, // an address doesn't move
    '/api/climate': { swr: 60 * 10 }, // ten-year climate is cached longer inside the route; today's weather isn't
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/**': { headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN' } },
  },
  app: {
    head: {
      title: 'Design a Food Forest',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover' }],
      link: [
        { rel: 'icon', href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌳</text></svg>" },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Alegreya:wght@400;500;700&family=Fondamento&display=swap' },
      ],
    },
  },
})
