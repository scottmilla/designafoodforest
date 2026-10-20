# Maintaining Design a Food Forest

Written so you can run, change and deploy the app without help. Skim section 1, then jump to the task you need.

## 1. The shape of the app

One Nuxt 4 project: a static single-page app (`ssr: false`) plus a few small server routes.

```
browser (does nearly all the work)                         server (Vercel functions)
─────────────────────────────────                          ─────────────────────────
Intro → Map (Leaflet + our canvas) → Forest (three.js)     /api/geocode (+ /suggest) → Esri World Geocoder, OSM fallback
all state in app/composables/useDesign.ts                  /api/climate  → Open-Meteo (10-yr history + weather)
designs saved in localStorage; files via JSON / KML        /api/species  → the species library, from MongoDB (only)
/admin: the species library editor                         /api/admin/*  → sign-in + species edits (MongoDB)
```

| Where | What |
| --- | --- |
| `app/composables/useDesign.ts` | **The brain of the UI.** One shared store: which screen you're on, the plot (boundary, rows, plants, keylines), every action (fill rows, recipe, undo, import/export, saves), and `scene` (the design in metres for 3D). Start here for any behaviour change. |
| `app/utils/geo.ts` | Geometry: land area, straight rows, keyline offsetting, snapping, KML parse/build. Pure functions, covered by `tests/geo.test.ts`. |
| `app/utils/suggest.ts` | **Suggest a design**: the ported goal-scoring engine (section 2). |
| `app/utils/library.ts` | The species library API: strata, site-fit rules (`fitFor`), crown width and clearance rules, yield curves, Byron id mapping. |
| `app/utils/growth.ts` | How plants grow with the year slider, when they're thinned, how crowns lift. |
| `app/utils/support.ts` | The support layer: which nitrogen / biomass / pioneer species suit the site per stratum, and how densely. Placed by `plantSupport` in `useDesign.ts`; those plants carry `role: 'support'`. |
| `app/components/ui/PlotBar.vue` | Several plots per design (Byron's multi-plot model). The active plot lives in `plot`; `plots` holds them all; `commitActive` / `loadPlot` swap them. |
| `app/pages/admin.vue`, `server/api/admin/*`, `server/utils/db.ts`, `shared/speciesSchema.ts` | The species admin panel, its MongoDB storage, and the one validator both sides use. |
| `server/utils/geocoders.ts`, `addressText.ts` | Address search: Esri first (real address points for rural US / NZ), OpenStreetMap second, NZ "RD n" and unit clean-up, ranking. |
| `app/utils/paint.ts` | Draws the design over the satellite photo (canvas). |
| `app/components/map/DesignMap.vue` | Leaflet map, click handling per tool, the zoom-in-to-dive. |
| `app/components/scene/*` | The 3D world (sky, ground, plants, gardener, camera). `FarmPlants.vue` draws the plants, `CameraRig.vue` the camera, `GroundTap.vue` clicks. |
| `app/components/ui/*` | Panels: `Intro`, `MapHud`, `StepDock` (flip card) → `LandPanel` / `RowsPanel` / `PlantPanel`, `HarvestBody`, `SpeciesCard`, `ForestHud`. |
| `app/assets/css/main.css` | All styling (the lasur/watercolour look). Colours and the shared edge margin `--edge` are CSS variables at the top. |
| `server/api/*`, `server/model/climate.ts` | The two routes and the hardiness-zone / climate maths. |
| `shared/types.ts` | Types shared by app and server. |
| `private/` (git-ignored, not in the repo) | `SPECIES_DATA_LIBRARY.md` (Byron's Codex) and the `library.json` built from it. The live library is in MongoDB; this is the working copy for `npm run library` and the tests. Keep a backup (Export JSON in `/admin`). |
| `data/` | `pff-species.ts` (our species model), `syntropic-designer-v13.html` (Byron's original, for reference). |
| `scripts/build-library.ts` | Turns the Codex + our species model into `private/library.json`, to import in `/admin`. |

Commands:

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # geometry + library tests
npm run typecheck  # TypeScript across app and server
npm run library    # rebuild private/library.json from private/SPECIES_DATA_LIBRARY.md (Node 24+), then import it in /admin
npm run build      # production build (what Vercel runs)
```

In dev, `window.__d` is the whole store and `window.__map` the Leaflet map: type `__d.plot` in the browser console to inspect a design.

## 2. Is there an AI model? Where does it run?

**No. There is no AI, machine-learning model or LLM anywhere in this app.** It makes no model calls, has no AI API keys and costs nothing per use. Everything that feels smart is a deterministic rule you can read and edit. The places that look like intelligence:

| Feature | How it actually works | File |
| --- | --- | --- |
| ✨ **Suggest a design** | **The plantafoodforest engine ("Syntropic Sage"), ported.** You pick one or two ranked goals (money, year-round, natives, restoration, rare, timber). Every species that fits the address is scored against them (value and early yield for money, harvest-calendar coverage for year-round, native-ness, wildlife and nitrogen for restoration, hardiness-edge and rarity for rare, timber role), each stratum's pool is filled from the top scores, then support trees, a herb layer and ground cover are added. Output is an editable recipe plus a plain-English "why this design" list. It is aimed at *your drawn rows*; where each plant lands is decided by the crown-clearance rules below. Same input gives the same output. | `app/utils/suggest.ts`, applied by `applyRecipe(…, 'mix')` in `useDesign.ts` |
| Reading the Codex | A regex parser pulls each data card's spacing, size, soil, pruning and hard bans out of the markdown; a hand-kept table (`MATCH`) joins each card to our species model for zones, yields, roles and native regions. Runs only when *you* run `npm run library`. | `scripts/build-library.ts` |
| Climate for an address | Ten years of daily temperatures from Open-Meteo → lowest-temperature average → USDA zone, chill hours, frost-free days. Plain maths. | `server/model/climate.ts` |
| 🟢🟡🔴 "Will it grow here?" | Rules in order: Codex frost bans, then hardiness zones and chill hours, then the Codex climate tags. Genus cards use their hardy end (`HARDY_END` in the build script, e.g. citrus). | `fitFor` in `app/utils/library.ts` |
| Keeping crowns apart | Each species' crown can't exceed its Codex Target RS; two plants must stand at least a set share of their crowns' radii apart (by strata distance), sliding along the row to find room. | `clearance` / `managedWidth` in `library.ts`, `makeGuard` in `useDesign.ts` |
| Growth, thinning, harvest | Fixed curves: size by lifecycle clock; managed thinning by role (nurse trees mostly gone by year 10, crop trees thinned ~25%, herbs and ground cover never), in a regular staggered order, with survivors' crowns widening to close the gaps; yield ramp → plateau → decline (Byron's model), scaled down when a stratum exceeds its canopy share. | `growth.ts`, `HarvestBody.vue` |

What was *not* ported from the engine: its generated layout (invented rectangle, ponds, swales, paths), its variants A/B/C, and its extra species that aren't in the Codex (it knows ~140; the library has the Codex's 128, so the **natives** goal is thin for most regions: the suggestion says so). To widen it, add species to `data/pff-species.ts` *and* give them a Codex-style entry, or extend the build script to include model-only species.

**If you want real AI later**, the natural seams are: (1) ask an LLM to *refine* `suggestDesign`'s output or to pick from its candidates, then *validate every pick with `fitFor` and the clearance rules* so it can't suggest what won't grow; (2) a "describe your goals in words" box that sets the goal weights; (3) photo → species ID. Any of these needs a server route that holds the API key (never put a key in browser code) and its own rate limit and per-use cost budget.

## 3. Will it scale?

**The compute scales for free**: every visitor's own browser does the planting, geometry, painting and 3D. The server only forwards two small requests per design. Measured on a 12 ha test design (15,842 plants, 75 rows) in dev:

| Operation | Time |
| --- | --- |
| Fill four layers into every row | ~0.5 s |
| Build the 3D scene data | ~30 ms |
| Repaint the map overlay (zoomed out) | ~24 ms (zoomed in ~10 ms) |
| 3D frame rate | **not measured** (the test browser was hidden); the plants are drawn with a dozen or so instanced meshes, and 3,400 plants looked fine in testing, but I never measured frame rate. Test a big design on a laptop and phone before promising it. |

What will actually limit you, in the order you'll hit them:

1. **Third-party services (the real ceiling).**
   - *Esri World Geocoder* (addresses and the type-ahead): used anonymously unless `NUXT_ARCGIS_KEY` is set. Anonymous use is fine for a design tool; for a commercial product get an ArcGIS location-services key (it has a free monthly tier) and set it. Saving designs that contain a geocoded point counts as "stored" geocoding in Esri's terms, so the key matters once this is a product.
   - *OpenStreetMap Nominatim* (fallback and reverse lookups for typed coordinates): ~1 request per second, identify yourself, no heavy commercial use. The code spaces requests and sends `NUXT_CONTACT_EMAIL`. Swap providers in `server/utils/geocoders.ts`; nothing else changes.
   - *Open-Meteo* (climate): free for non-commercial use with daily limits; commercial use needs their paid plan. It sometimes answers "overloaded"; the app handles that (design works without live weather, zone falls back to a latitude estimate).
   - *Esri World Imagery* (satellite photo, loaded straight from the browser): check Esri's terms for your use. A commercial product normally needs an ArcGIS licence or another imagery provider (Mapbox, MapTiler, Google). Change the tile URL in `DesignMap.vue` and `SatGround.vue`. It is only sharp to zoom 19; the 3D ground reuses the same tiles.
   - *Vercel Hobby* is for non-commercial use; a product needs Pro.
2. **Saved designs live only in the visitor's browser** (`localStorage`, key `daff.designs.v1`). About 100 bytes per plant, ~5 MB browser limit: roughly three 15,000-plant designs. Clearing site data deletes them, and nothing can be shared by link. The app tells people when storage is full and offers JSON export. Accounts, sharing and cloud saves need a backend (Vercel Postgres / Blob, Supabase, Firebase); the save format is one JSON object (`SavedDesign` in `useDesign.ts`), so adding it is contained.
3. **Rate limits are per server instance** (`server/utils/limit.ts`). They stop casual abuse but are not a hard guarantee on serverless. For a real limit use Vercel Firewall rate limiting or an Upstash counter.
4. **Climate cache is per instance too** (`defineCachedFunction` in `climate.get.ts` uses memory on Vercel). It only saves repeat lookups; add Vercel KV / Upstash if you want a shared one.

## 4. Deploying on Vercel

1. Put the project on GitHub (`git add -A && git commit`, push). `.env` is already ignored.
2. In Vercel: *Add New → Project → import the repo*. It detects Nuxt; leave the build command (`npm run build`) and output as default. Node 20+ is required (`engines` is set).
3. Settings → Environment Variables (all optional, see `.env.example`):
   - `NUXT_CONTACT_EMAIL`: your email, for OpenStreetMap.
   - `NUXT_ARCGIS_KEY`: ArcGIS key for the address search (recommended for commercial use).
   - `NUXT_MONGODB_URI` (+ `NUXT_MONGODB_DB`): the species database. MongoDB Atlas: create a free cluster, a database user, allow network access from `0.0.0.0/0` (Vercel's IPs change), copy the connection string.
   - `NUXT_ADMIN_PASSWORD`: the password for `/admin`. Without it the admin panel stays closed. `NUXT_SESSION_SECRET` (32+ random characters) signs its cookie.
   - **The species library is only in the database.** With no database (or an empty one) the designer has no species to plant. First time: open `/admin`, sign in, **Import a library file** (`private/library.json`, or an Export JSON). Export a backup from `/admin` now and then.
4. Deploy. Check: the title loads, an address flies the map, tracing land works, *Step inside* shows the forest.

What `nuxt.config.ts` sets up for it: the app shell is a prerendered static file (fast, no function call), API answers are cached by Vercel's CDN through `cache-control` headers each route sets (never `swr` / `isr` route rules on the API: on Vercel those become ISR functions that don't receive the query string, which broke the climate and address lookups), functions get up to 30 s (`nitro.vercel.functions.maxDuration`), hashed assets cache for a year, and basic security headers are sent. `NITRO_PRESET=vercel npm run build` reproduces the Vercel build locally (output in `.vercel/output`, ignored by git).

Before going public: confirm you have **permission to publish Byron Austin's Codex data**: it's no longer in the repo, but `/api/species` still sends the whole library to every visitor's browser (the designer needs it to plant), and decide which imagery and geocoding provider you'll license for commercial use (section 3).

## 5. Common changes

**Add or edit a species (with a database): `/admin`.** Sign in, pick a species, edit, Save. New species: ＋ New species (or Duplicate a similar one). Every field is checked by `shared/speciesSchema.ts`. The designer picks changes up within about 30 seconds (`/api/species` is cached that long). Ids never change once made: saved designs refer to them. **Export JSON** in the admin panel is your backup.

**Rebuild the whole library from the Codex.** Edit its card in `private/SPECIES_DATA_LIBRARY.md` (keep the `**Strata:**`, `**Dimensions:**`, `**Target RS:**` line formats). Zones, yields, prices, colours, form: `data/pff-species.ts`, and make sure the Codex name maps to it in `MATCH` in `scripts/build-library.ts` (`look:` borrows only colour and form). Then `npm run library`, `npm test`, and in `/admin` → **Replace with a file…** `private/library.json` (this overwrites edits made in the admin panel: export first).

**A genus card is too tender or too hardy** (e.g. citrus): add it to `HARDY_END` in the build script. **A price looks wrong:** `PRICE_FIX` in the same file, or edit `price` in `pff-species.ts`.

**Change what "Suggest a design" picks.** Scores per goal: `goalScore` in `suggest.ts`; how many species per layer: the `base` table in `suggestDesign`; row spacing per goal: `ROW_SPACING`; herb and ground counts: `herbN`.

**Change layout rules.** Crown cap: `managedWidth`. How close layers may stand: `CLEAR` in `library.ts`. Years to full size and thinning: `matureAge`, `thinnedShare` in `growth.ts`. Yield curve and canopy shares: `yieldAt`, `OCCUPANCY` in `library.ts`.

**Change the look.** Colours and the shared panel margin (`--edge`): top of `main.css`. Strata colours: `STRATA` in `library.ts`. Map imagery: tile URLs in `DesignMap.vue` / `SatGround.vue`.

**Change where designs save.** `SAVE_KEY` and `readSaves` / `writeSaves` in `useDesign.ts`. If you change the saved shape, bump the key (`v1` → `v2`) or add a migration so old saves don't break.

## 6. Things that will bite you

- **New or renamed component files:** restart `npm run dev`. Nuxt's auto-import doesn't always notice, and the symptom is an empty `<harvestbody>` tag.
- **The library is in the database, not the code.** A fresh clone has no species: tests that need them skip, and the dev server needs `NUXT_MONGODB_URI` pointing at a database with the library imported.
- **Byron file compatibility.** Species ids are rebuilt with his `sp_<name>_<strata>` rule (`toByron` / `fromByron` in `library.ts`). Renaming a Codex species changes its id and breaks old files that use it.
- **The page is pinned to the visible window** (`pin()` in `pages/index.vue` plus the "one fixed, non-scrolling page" block in `main.css`) and browser pinch-zoom is blocked, because zoomed pages pushed the panels off screen. The map and forest have their own zoom. Don't remove either without testing small windows.
- **CSS that targets `canvas`** can hit Leaflet's overlay (`canvas.design-ov`) as well as the 3D one. Keep selectors specific.
- **Panels all follow one rule:** capped at the window's height and scrolling inside themselves (`.card, .system, .menu` near the end of `main.css`). Give new panels the `card` class and they inherit it.
- **Rows are the source of truth for plants.** Moving rows re-attaches plants to the nearest row (`retag`) but never moves them. Fills refresh only the species being filled.
- **Tests:** `npm test` covers geometry and the library rules, not the UI. After UI changes, click through the five steps (address → trace → rows → plant → step inside → harvest flip) yourself.
