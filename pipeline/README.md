# Hearthbeat data pipeline

Turns NASA data into what the web app plays: NASA Earth Information Center (EIC) visualization
frames from the Scientific Visualization Studio (SVS), and NASA GISTEMP v4. Output format:
[`../docs/DATA.md`](../docs/DATA.md) (contract v2). Every layer and track is configured in
[`sources.json`](sources.json); adding a NASA visualization is a config change, not a code change.

## Run

```sh
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m hearthbeat_pipeline.build --out ../app/public/data      # fetch, decode, validate, swap in
.venv/bin/python -m hearthbeat_pipeline.accuracy --out ../app/public/data/accuracy.json   # compare with NASA raw data
.venv/bin/python -m hearthbeat_pipeline.validate ../app/public/data --write  # re-check (and refresh validation.json)
.venv/bin/python -m pytest -q                                               # offline tests
```

Options: `--layers precip pm25` rebuilds only some layers, `--days` / `--step-hours` change the
playback window (default from `sources.json`: 5 days every 6 hours). Downloads are cached in
`pipeline/cache/` (frames are ~6 MB each; SVS page JSON and frame listings are always re-fetched).

## What `build` does

1. **Discover** (`svs.py`): `https://svs.gsfc.nasa.gov/api/<id>` lists the page's media; the
   `Frames` entry is a folder of 2048×1024 PNGs, one per hour.
2. **Time** each frame. The GEOS animations end at **20:00 UTC** on the day of the frames'
   `Last-Modified` header and step back one hour per frame. Checked against the burned-in labels on
   2026-11-06: last frame "04 Nov 2026 15:00:00 EST" = 20:00 UTC, first frame "20 Oct 2026
   05:00:00 EDT" = 09:00 UTC. (An older version assumed 16:00 *local*, which made every frame an
   hour late after DST ended on 1 Nov; `tests/test_timing.py` pins the labels.)
3. **Playback steps**: a common window for all EIC layers, every `stepHours` (00/06/12/18 UTC),
   ending at the newest frame every layer has. Each step uses the frame at exactly that hour.
4. **Globe layer** (`pictures.py`): the data lifted off the NASA frame as a 2048×1024 RGBA WebP
   (`o###.webp`), drawn by the app over its own lit Earth. `rain-clouds` (precipitation): pixels in
   the colorbar keep NASA's colour; clouds become white with an alpha measured against the frame's
   own cloud-free background (per pixel, the darkest frames of the build). `field` (PM2.5): NASA's
   colours, more opaque higher up the colorbar. `none` (context-only layers). The NASA/GMAO logo and
   date-label boxes (`overlays`) are transparent.
5. **Values** (`colorbar.py`, `grid.py`): the colorbar strip becomes a lookup table; each frame
   pixel is matched to the nearest colorbar colour (pixels too far from any colour — coastlines,
   labels, clouds — are skipped); median (rain: mean) per 1° cell; quantised to one byte
   (`g###.bin`).
6. **GISTEMP** (`climate.py`): annual means of the monthly 2° anomalies (a cell needs ≥ 9 months),
   1880 to the last complete year, plus NASA's global mean series; pictures drawn with a
   blue–white–red scale.
   Cells at least half hidden by the NASA logo or the date label are stored as no data (filling them
   from neighbours was measured to be badly wrong, e.g. West Antarctica 5–6 °C too warm).
   Downloads are cached per render (`cache/frames/<layer>/<Last-Modified>/`), because SVS reuses the
   same file names every day.
7. **Model values where the picture can't be trusted** (`raw.py`): a layer with a `values` block takes
   its numbers from NASA model output at the same hour (OPeNDAP, sampled at 1° cell centres) and keeps
   the EIC frame as its picture. Used for PM2.5: the accuracy test found its frames don't follow their
   colorbar (decoded values ~4× too low).
8. **Validate** (`validate.py`) in a staging folder; only valid data replaces the old data.
   A layer that fails keeps its previous good data (marked `stale`, with its real times) and the
   reason goes in `manifest.errors`. Nothing is ever simulated.

## Layers (sources.json)

| key | source | values | status |
|---|---|---|---|
| precip | SVS 5149, GEOS-FP precipitation | linear 0–20 mm/h colorbar, stored log 0.1–20 mm/h | on (Rain track) |
| pm25 | SVS 5151, GEOS-CF surface PM2.5 | picture: the EIC frame; **numbers: GEOS-CF v2 `pm25_rh35` from NCCS OPeNDAP** (analysis, then the latest forecast), log 0.4–409.6 µg/m³ | on (Air quality track) |
| temp | SVS 5147, GEOS-FP near-surface temperature | linear −40–40 °C | on (context value) |
| tanom | NASA GISTEMP v4, 1200 km smoothing | linear −6…6 °C anomaly vs 1951–1980 | on (Climate track) |
| wind | SVS 5148 | — | **off**: calm air is drawn transparent over a grey land map, so wind over land cannot be read from the picture |
| ndvi | SVS 5544 | — | **off**: the series stopped on 2026-06-13 and its colorbar has no numbers |

## Accuracy

`accuracy.py` compares the values recovered from the pictures with NASA's raw model output for
the same hour (GEOS-FP and GEOS-CF via the NCCS OPeNDAP server), on a seeded random sample of
cells, and also checks the frame timing by scanning ±3 h offsets. Method and results:
[`../docs/ACCURACY.md`](../docs/ACCURACY.md).

## Adding a NASA visualization (e.g. after the challenge resources are published)

```sh
.venv/bin/python -m hearthbeat_pipeline.probe 5149 https://svs.gsfc.nasa.gov/5150 --stubs stubs.json
.venv/bin/python -m hearthbeat_pipeline.probe --from-text pasted-resources.txt --out report.json --stubs stubs.json
```

The probe pulls SVS ids out of any pasted text, lists each page's frame folders and colorbars,
checks the colorbar can be read and how many frame pixels match it, and writes a draft
`sources.json` entry. The draft is disabled with `min`/`max` = null: read those (and `scale`,
`unit`) off the colorbar labels, paste the entry into `sources.json`, set `"enabled": true`,
and point a theme at it if it should be a track. Then run `build`. On GitHub the same probe runs
from **Actions → Probe new NASA sources** (paste the resource list into the form).

Known gaps the probe reports: pages that only publish a movie (no frame folder), non-2:1 frames
(other projections), and colorbars without numbers.

## Limitations

- **Model data, not observations** for Rain and Air quality (GEOS-FP / GEOS-CF analyses and short
  forecasts). Climate is observation-based (GISTEMP).
- **Colour quantisation**: about 390 colour steps per colorbar plus image noise; see ACCURACY.md
  for measured errors. Rain under thick cloud is drawn over by clouds and under-counted.
- **Air quality classes** compare hourly model values with the WHO daily guideline; they are a guide.
