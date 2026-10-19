# Design a Food Forest

A syntropic food forest designer for your actual land. Type an address, fly down onto the satellite photo, stake out the land, lay out rows, and plant them from the Food-Forestry Codex species library. When you zoom past what the satellite can show, you dive into a painted 3D forest of the same design and can walk it, watch it grow year by year, and tap any tree for its data card.

It blends two tools:

- **Plant a Food Forest** (`../plantafoodforest`): the look and feel. Fondamento + Alegreya, lasur watercolour cards, the live sky and weather at the site, the 3D plants, the gardener, the year slider.
- **Byron Austin's Syntropic Planting Designer v13** (`data/syntropic-designer-v13.html`) and **Food-Forestry Codex VOL2_4 Species Data Cards** (`data/SPECIES_DATA_LIBRARY.md`): the technical substance. Satellite boundary, straight and keyline rows, A/B lines, fill zones, Target and Design RS spacing, row patterns, production model, KML in and out.

```bash
npm install
npm run dev       # http://localhost:3000
npm test          # geometry + library tests
npm run library   # rebuild shared/library.json after editing either species source
npm run typecheck # TypeScript across app and server
```

**Maintaining or deploying it? Read [MAINTENANCE.md](MAINTENANCE.md):** how the code fits together, where the "AI" is (there is none; it is all readable rules), what will and won't scale, the Vercel steps, and the licensing checks to make before going public.

## How it flows

1. **Where is your land?** Any address, place or `lat, lng` → `/api/geocode` (OpenStreetMap Nominatim). The map flies there immediately while `/api/climate` reads ten years of Open-Meteo history for the hardiness zone, chill hours, frost-free days and climate class.
2. **Land.** Tap the corners (tap the first corner again, or ✓, to close; no double-click needed), or import a KML polygon. A KML with several polygons asks which one.
3. **Rows.** Straight rows redraw live as you drag spacing and direction (presets for market garden / food forest / orchard / tractor alleys, one-tap north–south, align to the longest edge, or tap two points). Or *Follow the slope*: trace a keyline and fill the land with offset rows, optionally inside a drawn zone and appended to existing rows.
4. **Plant.** The Codex library, pre-filtered to what grows at this address (🟢 good, 🟡 edge, 🔴 hidden unless you ask). Pick a plant to see its Target RS / Design RS, hard bans and fit, then place one (snaps to rows), tap a row to fill it, or fill every / A / B row. The **row recipe** is Byron's pattern tool in two modes: *Layered* (each plant fills its rows at its own spacing, the syntropic consortium) and *In sequence* (his original plant-gap-plant pattern). ✨ **Suggest a design** takes one or two ranked goals and fills the recipe from the species that fit the address (plantafoodforest's goal-scoring engine, ported), with a "why this design" list; "Mixed layers" then lets each layer's species take turns along your rows. The **canopy check** shows how much of the land each stratum's mature crowns cover against the Codex targets (E 20%, H 40%, M 60%, L 80%).
5. **Step inside.** The button, or simply zoom in past the satellite's resolution. The camera starts straight down where the map was and tilts into the forest, standing on the real satellite photo (toggle to a painted ground). Walk with WASD or taps, spin with Q/E, scrub the years, bird's-eye. 🛰 Back to the map returns you to where you're standing.

📊 Harvest projects yield or value by year and stratum with Byron's ramp → plateau → decline model, seeded from real per-plant yields where we have them, scaled down when a stratum is planted past its canopy share. Every number is editable.

Designs auto-save on the device. ☰ exports KML (Google Earth) and a design JSON in Byron's v3 project format; his project and plot files open here too, with his species ids mapped exactly.

## The species library

`scripts/build-library.ts` parses every Codex card (169 cards, 128 species) and joins each to our species model (`data/pff-species.ts`, copied from plantafoodforest) for what the cards don't carry: hardiness zones, chill hours, yields, harvest months, prices, colours and plant form. Spacing, dimensions, soil, pruning, succession and hard bans always come from the Codex. Where the Codex marks a "20×14 m" figure as Matrix biomass notation (its Section 5), or lists dwarf and standard sizes, the parser takes the plant's real standard size; 27 cards read differently from the v13 designer's parser for that reason. Yields from the species model are scaled to the Codex canopy size. Edit either source and run `npm run library`.

Site fit (`app/utils/library.ts → fitFor`) applies the Codex frost bans first, then zones and chill, then the Codex climate tags.

## Layout

| Path | What it is |
| --- | --- |
| `app/composables/useDesign.ts` | The single store: stages, the plot (Byron's data model), every design action, undo, saves, import/export, and the design in 3D scene metres |
| `app/utils/geo.ts` | Byron's geometry, typed: local metre frames, scanline rows, keyline offsets, clipping, snapping, KML |
| `app/utils/paint.ts` | Paints the design over the satellite photo in the lasur style |
| `app/utils/library.ts` | Strata, lifecycles, fit rules, production model, Byron id mapping |
| `app/components/map/` | Leaflet + Esri World Imagery, the overlay canvas, the zoom-to-dive |
| `app/components/ui/` | Title, map HUD, the three step panels, species card, harvest, forest HUD |
| `app/components/scene/` | plantafoodforest's 3D world, adapted: sky, weather, meadow, wild forest ring, satellite ground, the land, the plants, the gardener, the camera |

## Caveats

- Yields and prices are planning numbers for comparing designs.
- Esri imagery is sharp to about zoom 19; the 3D satellite ground uses the same tiles, so it's soft up close.
- Nominatim's free service asks for no autocomplete and modest use: fine for a design tool, but put your own geocoder behind `/api/geocode` before heavy public traffic.
