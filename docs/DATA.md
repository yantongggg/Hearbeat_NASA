# Data contract v2: pipeline → app

The Python pipeline (`pipeline/`) writes everything the web app plays into `app/public/data/`.
For data, the app (`app/`) reads only these files. (It also loads the home recordings in
`app/public/home-sounds/` and the classroom PDFs, which are not data.)

```
app/public/data/
  manifest.json                 # this contract
  validation.json               # written by `python -m hearthbeat_pipeline.validate`
  accuracy.json                 # written by `python -m hearthbeat_pipeline.accuracy` (optional)
  <layer>/g<step>.bin           # value grid for one time step
  <layer>/grids.json            # the same grids for every step in one file (base64), see "pack"
  <layer>/o<step>.webp          # the globe layer for that step: RGBA, transparent where the Earth shows
  <layer>/colorbar.png          # the layer's colour legend
```

## `manifest.json`

```jsonc
{
  "version": 2,
  "generated": "2026-11-06T09:00:00Z",       // UTC time the pipeline ran
  "themes": {                                 // copied from pipeline/sources.json
    "rain":    { "layer": "precip", "context": ["temp"] },
    "air":     { "layer": "pm25",   "context": ["temp"] },
    "climate": { "layer": "tanom" }
  },
  "layers": { "<key>": Layer, ... },
  "errors": { "<key>": "why this layer is missing" }   // layers that failed this run
}
```

### Layer

```jsonc
{
  "key": "precip",
  "title": "GEOS-FP precipitation",
  "unit": "mm/h",
  "simulated": false,          // true ONLY for synthetic test data; the app labels it SIMULATED
  "encoding": { "scale": "log", "min": 0.1, "max": 20 },   // how bytes 1..255 map to values
  "grid": { "w": 360, "h": 180, "lat0": 89.5, "lon0": -179.5, "step": 1 },
  "source": {
    "kind": "eic-svs-frames",  // or "gistemp-netcdf"
    "agency": "NASA GMAO", "product": "GEOS-FP",
    "page": "https://svs.gsfc.nasa.gov/5149",
    "svs": 5149,               // EIC layers only
    "citation": "…"
  },
  "time": { "cadence": "PT6H", "label": "datetime", "timing": "how frame times were derived" },
  "steps": [
    { "t": "2026-10-30T00:00Z", "grid": "precip/g000.bin", "image": "precip/o000.webp",   // no "image" when picture.mode is "none"
      "frame": "https://svs.gsfc.nasa.gov/…/00000267.png",   // original NASA frame (EIC layers)
      "stats": { "matchedFraction": 0.31, "filledCells": 12, "nodataCells": 0 } }
  ],
  "colorbar": { "image": "precip/colorbar.png", "scale": "linear", "min": 0, "max": 20,
                "source": "https://…/Precipitation_colorbar_plain.png" },
  "series": { "global": [ { "t": "1880", "v": -0.17 } ] },  // optional, e.g. GISTEMP global mean
  "pack": "precip/grids.json",   // optional: {"w","h","encoding":"base64-uint8","steps":[<base64 grid>, …]}
  "overlays": [[0, 0, 0.175, 0.075]],   // optional: logo/label boxes in the NASA frame (fractions x0,y0,x1,y1); transparent in the layer
  "picture": { "mode": "rain-clouds" },  // how the globe layer was made: "rain-clouds" | "field" | "none" (see pipeline/hearthbeat_pipeline/pictures.py)
  "notes": "limitations a reader needs to know"
}
```

- `time.label` is `"datetime"` (ISO UTC, `YYYY-MM-DDTHH:MMZ`) or `"year"` (`"1880"`).
- `grid` is per layer. Row 0 is latitude `lat0` going south in `step` degrees; column 0 is
  longitude `lon0` going east. Cell centres, equirectangular.
- Images are equirectangular, 2:1, longitude −180…180 left to right, latitude 90…−90 top to bottom.
  They are RGBA (straight alpha) layers drawn over the app's own Earth (NASA Blue Marble / Black Marble):
  colour is NASA's where alpha > 0. A layer used by a track must have a picture (the validator checks).

## `.bin` grids

- `Uint8Array` of length `w × h`, row-major.
- Byte `0` = no data (masked pixel, ocean for land-only products, missing station coverage).
- Bytes `1–255`:
  - linear: `value = min + (q − 1) / 254 × (max − min)`
  - log: `value = exp(ln(min) + (q − 1) / 254 × (ln(max) − ln(min)))`
- Values outside `min…max` are clipped to the end codes.
- `pack` holds exactly the same bytes as the `.bin` files (validate checks this). Apps should
  prefer it: one request per layer, and it works on hosts that do not serve `.bin`.

## Rules

- A layer that fails is left out of `layers` and explained in `errors`. The app then disables
  the theme that needs it and says why. It never invents data in its place.
- `simulated: true` exists only for test fixtures; the app shows a SIMULATED badge on every value
  from such a layer.
- `validate` checks this file against the contract (shapes, sizes, ranges, step order, freshness)
  and the deploy workflow refuses to publish data that fails.

## The space station (`station.json`, Together)

Written by `pipeline/hearthbeat_pipeline/station.py` (also run by the daily build) from NASA's
predicted ISS trajectory: `https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt`,
produced by NASA JSC's Flight Operations Directorate (TOPO) as a CCSDS OEM file: position (km) and
velocity (km/s) in the EME2000 (J2000) frame, UTC, every 4 minutes for about 15 days.

Checks before it is written (otherwise no `station.json`, and the app says the position is
unavailable): frame EME2000, centre Earth, time UTC, at least 360 states, times increasing in steps of
at most 10 minutes, every state a low Earth orbit (6,650-6,900 km from the centre, 7.4-7.9 km/s),
inclination 51.0-52.2 degrees.

Fields: `t0` (first time), `s` (seconds after `t0`), `r` (x, y, z in km to 1 m; vx, vy, vz in km/s to
1 mm/s), `start`, `stop`, `source` (URL, NASA's creation time, download time) and `ascendingNodes`
(NASA's own node times and longitudes, copied from the file's comments and used by the unit tests).

The app (`app/src/data/station.ts`) interpolates with a cubic Hermite curve between states, applies
IAU 1976 precession and Greenwich mean sidereal time (nutation, under 0.01 degrees, is ignored) and
converts to WGS 84 latitude, longitude and height. Verified against the file: at both ascending-node
times NASA lists, latitude 0.00 degrees and longitude within 0.001 degrees of NASA's value.

## Lightning (`lightning/`, SVS 5011)

One of the ten visualizations listed in the challenge resources: "Lightning Events Detected from the
International Space Station (ISS) 2017-2023" (NASA SVS 5011; data: Quality Controlled LIS on ISS, NASA
GHRC DAAC). `pipeline/hearthbeat_pipeline/lightning.py` reads NASA's Science On a Sphere movie of it
(`iss_lightning_sos_yearly_07312023_2048p60.mp4`, 350 MB, 4096x2048, 60 fps, 6002 frames) and its
frame dates (`labels.txt`). Downloaded with the user's permission on 14 Nov 2026.

- **Map:** a plain world map, longitude -180..180 left to right, latitude 90N..90S top to bottom
  (Science On a Sphere's format). Re-checked every run by matching the grey base map's edges (coasts,
  mountains) with NASA Blue Marble (`app/public/tex/day.jpg`): best shift 0.0 degrees (must be within
  0.3), correlation 0.45 there and 0.38 two degrees off.
- **Dates:** one per frame. NASA's file writes 2023 as "2003" (1074 labels straight after 31 Dec 2022);
  only that case is read as 2023, and the run stops if the dates ever go back.
- **Frames:** NASA draws every event LIS saw in a roving 10-day window. One frame is taken every 10
  days (229 windows labelled 11 Mar 2017 to 22 Aug 2023), so no event is counted twice.
- **Values:** yellow marks are found by colour (min(R, G) - B; the grey map stays under 6) and averaged
  over each 1-degree cell: the share of the cell covered with marks, 0-100 %. The windows labelled in
  each calendar month are averaged over the years: twelve steps, January to December. Stored on a log
  scale 0.01..100 %; code 1 (0.01 %) means none seen. This is relative: LIS sees each place for about
  90 seconds per pass, and the marks have a drawn size.
- **Checks (every run):** the first frame (before any marks are drawn) has none; 0.00 % of marks lie
  beyond 58 degrees of latitude (the ISS cannot see there); 30-50N has 19x more in June-August than in
  December-February, 20-40S 4x more in December-February than in June-August.
- **Picture:** the month's marks as warm yellow on a 2048x1024 WebP, shown on a night-time Earth.
- **Build:** the visualization is finished, so the daily build reuses the published layer unless the
  code's `METHOD` or the movie URL changes (it does not download 350 MB every day).

## Night lights (`lights/`, SVS 5313)

One of the ten visualizations listed in the challenge resources: "Change in Night Lights between 2012
and 2023 - EIC Version" (NASA SVS 5313; Black Marble: Next Generation, NASA/NOAA Suomi NPP VIIRS). Its
frame folder returns 403, so `pipeline/hearthbeat_pipeline/nightlights.py` reads NASA's 34 MB movie of
it (7680x2160, 30 fps; two copies of a flat world map side by side, the year written between them).

- **Years:** the year label changes 11 times in the first 9 seconds; the middle frame of each of the
  12 stretches is that year (2012..2023, checked by eye on 13 Nov 2026). The run stops if there are
  not exactly 11 changes.
- **Light:** luminance of the year's frame minus the base map without lights (the darkest frame after
  the lights fade out, frame 289). Deserts and ice in the base map are therefore not counted as light.
- **Position:** the left copy starts at 168.6 degrees west and spans 360 degrees; rows run 90N..90S.
  Re-checked every run against NASA Black Marble 2016 (`app/public/tex/night.jpg`): best longitude
  -168.6 (must be within 0.3 degrees), correlation 0.42 there and 0.24 two degrees off.
- **Values:** the 1-degree cell mean of that light, as an index 0..100 (100 = the cell fully at the
  picture's brightest). The picture has no colour scale, so this is relative brightness, not radiance.
  Stored linear 0..100 in codes 1..255 (0 is never used: dark is data, not missing).
- **Picture:** the same light as a warm glow (opacity = light) on a 2048x1024 equirectangular WebP; the
  globe shows it on a night-time Earth, without the base map's own lights.
