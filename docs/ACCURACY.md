# Accuracy of the values recovered from the NASA pictures

Rain and temperature values are read back out of the colours of NASA SVS "Earth Information Center"
frames (see `pipeline/README.md`). PM2.5 values are downloaded from GEOS-CF model output instead; the
tables below show why. This page compares the recovered values with NASA's raw model output for the
same hour and place.

- **Run:** 2026-11-05 19:18 UTC (2026-11-06 local time), `--n 400 --seed 2026`, all three layers, no errors.
- **Output:** `pipeline/out/accuracy.json` (`pipeline/out/` is git-ignored; CI writes the same report to
  `app/public/data/accuracy.json`, which the app's "About the data" panel shows).
- **Code:** `pipeline/hearthbeat_pipeline/accuracy.py` (comparison) and `opendap.py` (OPeNDAP client);
  offline tests in `pipeline/tests/test_accuracy.py`.

Every number below was computed by that run and can be found in the JSON. Nothing is estimated.

## What we changed because of this test (2026-11-06)

| finding | change |
|---|---|
| **PM2.5 frames don't follow their colorbar**: decoded values about 4× too low on a compressed scale (r of log values 0.93, only 6–7 % within a factor of 2) | The Air quality numbers now come straight from **GEOS-CF v2 `pm25_rh35`** at the same hour (`pipeline/hearthbeat_pipeline/raw.py`: analysis collection, then the latest forecast for the newest hours). The globe still shows the EIC frame. The PM2.5 rows below describe the picture decoding we stopped using. |
| **Cells under the NASA logo / date label** were filled from neighbours and were badly wrong (temperature in West Antarctica 5–6 °C too warm, RMSE 9–10 °C) | Those cells are now stored as **no data**; the app says "no data" there. |
| **Frame cache keyed by URL only**, while SVS reuses file names every day | Downloads are cached per render time (`cache/frames/<layer>/<Last-Modified>/`). |
| The newest frames are **short forecasts**, not analyses | Stated in the layer notes shown in the app. |
| Frame timing | The burned-in date labels match the corrected times exactly; the correlation scan agrees to within about an hour (see the re-run below). |

## Re-run after the fixes (2026-11-05 20:01 UTC)

Same command, same seed, on the data the app now ships (cells under the logo and date label are no
data, so they are no longer sampled). Source: `app/public/data/accuracy.json`.

| layer | frame time (UTC) | | n | bias | MAE | RMSE | r | p90 abs. err. | best offset |
|---|---|---|---|---|---|---|---|---|---|
| temp (°C) | 2026-11-04T18:00Z | newest | 396 | +0.21 | 0.48 | 0.77 | 0.998 | 1.04 | -1 h |
| temp (°C) | 2026-11-03T18:00Z | −24 h | 397 | +0.16 | 0.39 | 0.58 | 0.999 | 0.83 | 0 h |
| precip (mm/h, rainy points) | 2026-11-04T20:00Z | newest | 106 | -0.09 | 0.28 | 0.52 | 0.333 | 0.52 | -1 h |
| precip (mm/h, rainy points) | 2026-11-03T20:00Z | −24 h | 99 | -0.02 | 0.18 | 0.30 | 0.820 | 0.33 | -1 h |
| pm25 (µg/m³, picture decoding — no longer used) | 2026-11-04T05:00Z | newest | 400 | -6.16 | 6.16 | 12.78 | 0.860 | 14.51 | -1 h |
| pm25 (µg/m³, picture decoding — no longer used) | 2026-11-03T05:00Z | −24 h | 400 | -5.72 | 5.72 | 10.18 | 0.799 | 14.01 | -2 h |

- **Temperature** improves to RMSE 0.58–0.77 °C once the label-covered cells are excluded.
- **PM2.5 rows describe the picture decoding we no longer use**; the app's PM2.5 numbers are GEOS-CF
  output itself, so their only added error is the one-byte storage step (codes are 2.8 % apart, so ±1.4 %).
- **Timing.** The correlation scans are shallow: across both runs the best offset is 0 h, −1 h or (one PM2.5 row) −2 h and the
  two are within ~0.01–0.03 in r (e.g. precipitation −24 h: 0.880 at −1 h vs 0.874 at 0 h). The scan
  therefore places the frames within about an hour of the stated times; the exact hour is confirmed by
  reading the burned-in date labels (frames 1, 346, 357, 370, 372), which match `discover()` times.

## First run (before the fixes)

"newest" is the newest frame whose time, plus the ±3 h scan window, is covered by the raw data; "−24 h" is
the frame one day earlier (`extra.dayEarlier` in the JSON). bias = mean(decoded − raw).
Points whose raw value lies outside the colorbar range are counted as "clipped" and left out of the stats.

| layer | frame time (UTC) | | n | bias | MAE | RMSE | r | median abs. err. | p90 abs. err. | clipped | best offset |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temp (°C) | 2026-11-04 18:00 | newest | 397 | +0.24 | 0.54 | 1.01 | 0.998 | 0.34 | 1.05 | 3 | 0 h |
| temp (°C) | 2026-11-03 18:00 | −24 h | 398 | +0.25 | 0.46 | 1.06 | 0.997 | 0.28 | 0.81 | 2 | 0 h |
| precip (mm/h), rainy points | 2026-11-04 20:00 | newest | 130 | −0.09 | 0.27 | 0.46 | 0.479 | 0.16 | 0.54 | 0 | 0 h |
| precip (mm/h), rainy points | 2026-11-03 20:00 | −24 h | 107 | −0.14 | 0.29 | 0.75 | 0.843 | 0.14 | 0.44 | 0 | −1 h |
| pm25 (µg/m³) | 2026-11-04 05:00 | newest | 400 | −6.33 | 6.52 | 13.69 | 0.688 | 2.69 | 14.00 | 0 | 0 h |
| pm25 (µg/m³) | 2026-11-03 05:00 | −24 h | 400 | −6.09 | 6.28 | 11.65 | 0.580 | 2.64 | 14.86 | 0 | 0 h |

Precipitation "rainy points" = decoded or raw ≥ 0.1 mm/h; the 400-point numbers including dry points
are in `extra.allPoints`. PM2.5 best offset uses r of log10 values (its colorbar is logarithmic).

Layer-specific numbers:

| | newest | −24 h |
|---|---|---|
| **temp** all valid cells, area-weighted, colour-measured cells: n / MAE / RMSE / r | 60 264 / 0.51 / 0.79 / 0.999 | 59 945 / 0.41 / 0.65 / 0.999 |
| **temp** cells under the logo / date label (filled from neighbours): n / bias / RMSE | 2 430 / +5.91 / 10.24 | 2 408 / +5.12 / 9.08 |
| **temp** implied colorbar range (labelled −40…40) | −39.2 … 39.3 | −39.8 … 39.6 |
| **precip** rain / no rain at 0.1 mm/h, sample: hit rate / false-alarm ratio / frequency bias | 0.68 / 0.13 / 0.78 | 0.82 / 0.07 / 0.88 |
| **precip** same, all 64 800 cells | 0.62 / 0.21 / 0.78 | 0.73 / 0.08 / 0.80 |
| **precip** mean over rainy points, decoded vs raw (mm/h) | 0.32 vs 0.41 | 0.44 vs 0.58 |
| **precip** all 400 points: r / RMSE | 0.645 / 0.26 | 0.851 / 0.39 |
| **pm25** log10(decoded/raw): mean / RMSE; r of log10 values | −0.615 / 0.646; 0.929 | −0.613 / 0.641; 0.952 |
| **pm25** median / p90 relative error; share within a factor of 2 | 0.77 / 0.86; 6.8 % | 0.76 / 0.85; 6.0 % |
| **pm25** implied colorbar range (labelled 0.4…409.6) | 1.27 … 10 129 | 1.17 … 16 771 |

"Implied colorbar range" (`extra.impliedRange`) is a least-squares fit of the raw value (log10 for PM2.5)
on the decoded colorbar position, read off at the two ends of the bar. It equals the labelled range when
decoding is right; it is a diagnostic, not a correction.

### What this says

- **Temperature is accurate.** Typical error about half a degree, r = 0.997–0.998, slope 1.00–1.01, and the
  implied range matches the labelled −40…40 °C. The decoded field is 0.2–0.25 °C warmer than t2m on average.
  10 m temperature fits about as well (r 0.997, bias +0.19 to +0.20 °C, `extra.fieldCheck`), so the comparison
  cannot tell whether NASA's "3 m" field is closer to the 2 m or the 10 m one. Clipped points (raw below
  −40 °C on the Antarctic plateau) decode to −40 °C, 0.21 °C from the clipped raw value on average.
- **Cells under the NASA logo and the date label are wrong for temperature.** `build.decode` fills them from
  neighbouring cells. The date label covers West Antarctica (lon −180…−90°, south of ~72° S). Those cells get
  values that are on average 5–6 °C too warm, with an RMSE of 9–10 °C. These 2 502 cells cover 0.87 % of the
  globe's area, so the area-weighted sample includes only 6 of them.
- **Precipitation is good at "where it rains", weaker at "how much".** About 2 in 3 to 4 in 5 raining cells
  are detected, false alarms are few, and frequency bias is below 1. Rain is under-detected, as expected
  where clouds are drawn over it. On rainy cells the decoded rate is 22–25 % lower on average, and heavy
  rain is read low (`extra.olsRainy` slope 0.35). The magnitudes confirm that the "mm" colorbar means mm per
  hour: mm per day would be off by a factor of 24.
- **PM2.5 shows the right pattern but not NASA's numbers.** In log space the decoded field correlates well
  with GEOS-CF `pm25_rh35` (r 0.93–0.95). The values are about 4× lower, though (mean log10 ratio −0.61),
  and only 6–7 % of points are within a factor of two. The implied scale runs from about 1.2 µg/m³ at the
  bar's left end, not 0.4, and stretches far beyond 409.6 at the right. GEOS-FP's own PM2.5 (the GOCART
  `pm25` in `inst1_2d_hwl_Nx`) matches worse: r of log values 0.59–0.61, about 7× low. So the frames do
  come from GEOS-CF, as the SVS page says. Either they colour a different PM2.5 quantity or scale than the
  labelled bar implies, or the frame colours are lighter than the bar. This run cannot tell which.
  **Before the fix, this meant: treat the app's PM2.5 values as relative (cleaner/dirtier), not as
  µg/m³. The app now takes its PM2.5 numbers from GEOS-CF output, so this no longer applies.**
- **The newest frames are forecasts.** All frames were rendered about 07:30 UTC on 4 Nov, so frames after
  that time come from a forecast. For the newest precipitation frame (20:00Z), the GEOS-FP forecast started
  2026-11-04 00Z fits much better than the analysis: all-point r 0.757 vs 0.645, RMSE 0.21 vs 0.26 mm/h. The
  other start times fit worse (r 0.39–0.55; `extra.forecastCheck`). So the analysis comparison partly
  measures forecast error, not decoding error. For temperature and PM2.5 the analysis and the forecasts fit
  about equally well (temp r 0.9977–0.9980; pm25 r 0.67 vs 0.69).

## Frame timing

**Bug fixed in this round.** `build.py` used to place the last frame of each GEOS animation at 16:00 *US
Eastern local time* on the frames' Last-Modified day. DST ended on 2026-11-01, so after that date this put
every frame **1 h late** (last frame 21:00Z instead of 20:00Z). The animations are anchored in UTC. The fixed
rule is: last frame = 20:00 UTC on the Last-Modified day, one hour earlier per frame. `accuracy.py` takes
its frame times from the fixed `build.discover()`.

**Label check.** The burned-in date labels of the frames used here match those times on all three pages:

| frame | label | UTC | `discover()` time |
|---|---|---|---|
| 00000370.png | "04 Nov 2026 13:00:00 EST" | 2026-11-04 18:00Z | 18:00Z |
| 00000346.png | "03 Nov 2026 13:00:00 EST" | 2026-11-03 18:00Z | 18:00Z |
| 00000357.png | "04 Nov 2026 00:00:00 EST" | 2026-11-04 05:00Z | 05:00Z |

The coordinator also read the labels of 00000372.png ("04 Nov 2026 15:00:00 EST" = 20:00Z) and
00000001.png ("20 Oct 2026 05:00:00 EDT" = 09:00Z).

**Offset scan.** Decoded values are correlated with raw values at frame time + h, using the same points.
Hourly sources give the value at an integer hour as the mean of the two hourly means around it. The scan is
repeated against the forecast that fits best (`extra.forecastScan`). Values are r (PM2.5: r of log10).

| scan | −3 h | −2 h | −1 h | 0 h | +1 h | +2 h | +3 h | best |
|---|---|---|---|---|---|---|---|---|
| temp newest, analysis (tavg1 t2m) | 0.9923 | 0.9954 | 0.9972 | **0.9975** | 0.9968 | 0.9956 | 0.9940 | 0 |
| temp −24 h, analysis | 0.9933 | 0.9958 | 0.9972 | **0.9972** | 0.9964 | 0.9953 | 0.9939 | 0 (tie with −1) |
| temp newest, forecast 2026-11-03 12Z | 0.9930 | 0.9960 | 0.9977 | **0.9980** | 0.9973 | 0.9962 | 0.9948 | 0 |
| precip newest, analysis | 0.2610 | 0.3915 | 0.5854 | **0.6445** | 0.6076 | 0.3590 | 0.2533 | 0 |
| precip −24 h, analysis | 0.5975 | 0.7632 | **0.8738** | 0.8507 | 0.8308 | 0.7724 | 0.6333 | −1 |
| precip newest, forecast 2026-11-04 00Z | 0.2939 | 0.2401 | 0.2931 | **0.7570** | 0.5954 | 0.3874 | 0.3536 | 0 |
| pm25 newest, analysis | 0.9191 | 0.9235 | 0.9271 | **0.9289** | 0.9286 | 0.9257 | 0.9206 | 0 |
| pm25 −24 h, analysis | 0.9435 | 0.9482 | 0.9514 | **0.9518** | 0.9496 | 0.9445 | 0.9371 | 0 |
| pm25 newest, forecast 2026-11-03 09Z | 0.9211 | 0.9250 | 0.9288 | **0.9318** | 0.9317 | 0.9289 | 0.9242 | 0 |

8 of the 9 scans peak at 0 h (the −24 h temperature scan ties 0 h with −1 h). The exception is the −24 h precipitation frame, which peaks at −1 h (r 0.874 vs
0.851 at 0 h). Precipitation against its matching forecast gives the sharpest peak: 0.757 at 0 h against 0.60
at +1 h and 0.29 at −1 h. Temperature and PM2.5 change slowly, so their peaks are shallow (neighbouring
hours are at most 0.003 lower in r). On their own those scans only say "within about an hour". With the old rule each
frame was labelled 1 h later, so these scans would have peaked at −1 h. **Together, the labels and the
scans confirm the fix.**

The scan on single hourly means (`extra.hourlyMeanScan`) does not show which hour precipitation is averaged
over. The −24 h analysis frame fits the hour before T best (r 0.861 vs 0.811 for the hour after), while the
newest frame against its forecast fits the hour after T best (0.775 vs 0.677).

## Method

1. **Frames.** `build.discover(layer)` gives the frames and their times. The newest frame T is taken whose
   main raw time(s), and every raw hour from T−3.5 h to T+3.5 h, lie on the raw dataset's time axis. The
   frame 24 h earlier is evaluated too. `--at temp=2026-11-04T18:00Z …` forces a frame time. Frames are
   downloaded into `pipeline/cache/accuracy/frames/<layer>/<render time>/`. SVS reuses the same file names
   every day, so they are keyed by the HTTP Last-Modified time.
2. **Decoding.** `build.build_lut(layer, colorbar)` + `build.decode(layer, lut, rgb)`. This is the float
   grid the app quantises, including its hole filling.
3. **Raw data.** OPeNDAP ASCII subsets: every 2nd 0.25° latitude from −89.75° (2 rows per 1° cell, ±0.25°
   from its centre) and every 2nd longitude (GEOS-FP 0.625°, 1–2 points per cell; GEOS-CF 0.5°, 2 per cell).
   Requests are split into latitude bands of at most 80 000 values (about 1 MB). The raw value of a cell is
   the **mean of the subset points inside the cell** (2–4 points; NaN fill values skipped). "tavg1" sources
   are hourly means stamped at the middle of the hour; their value at T is the mean of the hours T−1…T and
   T…T+1. Every response carries its own time coordinate. The client checks it against the requested time
   and refuses a mismatch. Responses are cached in `pipeline/cache/opendap/`.
4. **Sampling.** 400 cells, drawn without replacement with probability proportional to cos(latitude)
   (cell area), using `numpy.random.default_rng(2026)`. Only cells where both the decoded and the raw value
   are valid are eligible. The same points are used for every offset and every alternative field.
5. **Clipping.** A raw value outside the colorbar range (temp −40…40 °C, precip 0…20 mm/h, PM2.5
   0.4…409.6 µg/m³) is counted in `clipped` and left out of the stats. For the offset scans and the
   alternative fields, raw values are clipped to the colorbar range.
6. **Statistics.** n, bias, MAE, RMSE, Pearson r, median and 90th-percentile absolute error. Also:
   - precipitation: the stats are on rainy points, plus a 0.1 mm/h contingency table on the sample and on
     all cells;
   - PM2.5: log10-ratio bias/MAE/RMSE, r of log10 values, relative errors and share within a factor of 2;
   - all layers: area-weighted stats over every valid cell, split into colour-measured cells and cells
     touched by the logo/label boxes.
7. **Timing and source checks.**
   - Offset scan from −3 h to +3 h (best = highest r; log r for PM2.5; a tie goes to the smaller shift).
   - Scan on single hourly means.
   - Comparison with GEOS forecasts started in the 24 h before rendering, and a scan against the best one.
   - Alternative raw fields at 0 h.

## Datasets and variables

Server: NASA NCCS GrADS Data Server, no login. Time values are "days since 1-1-1". Value − 2 days, counted
from 0001-01-01 in the proleptic Gregorian calendar, is UTC. This was checked against each dataset's
`grads_min`.

| layer | role | dataset (OPeNDAP URL) | variable → unit | coverage at run time |
|---|---|---|---|---|
| temp | main (instantaneous at T) | `https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx` | `t2m` K − 273.15 → °C | 2017-12-01 00Z – 2026-11-05 09Z, 3-hourly |
| temp | offset scan, forecast check | `…/GEOS-5/fp/0.25_deg/assim/tavg1_2d_slv_Nx`, `…/fp/0.25_deg/fcast/tavg1_2d_slv_Nx/tavg1_2d_slv_Nx.YYYYMMDD_HH` | `t2m` → °C (hourly means) | assim to 2026-11-05 08:30Z |
| temp | alternative | `…/assim/inst3_2d_asm_Nx` | `t10m` → °C | as above |
| precip | main, scan | `…/GEOS-5/fp/0.25_deg/assim/tavg1_2d_flx_Nx` (+ `fcast/tavg1_2d_flx_Nx/…YYYYMMDD_HH`) | `prectot` kg m⁻² s⁻¹ × 3600 → mm/h | assim to 2026-11-05 08:30Z |
| precip | alternatives | same | `prectot − precsno` (liquid), `preccon` (convective) | |
| pm25 | main, scan | `https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/v2/ana/aqc_tavg_1hr_glo_L1440x721_slv` (+ `v2/fcst/aqc_tavg_1hr_glo_L1440x721_slv/…YYYYMMDD_09z`) | `pm25_rh35` µg/m³, level 72 (surface) | 2025-08-04 09:30Z – 2026-11-04 08:30Z |
| pm25 | alternative | `…/GEOS-5/fp/0.25_deg/assim/inst1_2d_hwl_Nx` | `pm25` kg m⁻³ × 10⁹ → µg/m³ | 2026-02-27 – 2026-11-04 23Z |

Notes on the choice of fields:

- **Temperature.** SVS 5147 samples GEOS-FP 3-D fields 3 m above the surface. That field is not published
  on OPeNDAP, so 2 m air temperature (`t2m`) is the nearest raw field. `t10m` is shown as an alternative.
- **Precipitation.** The SVS page says the frames are "calculated using fields from GEOS-FP". The bar is
  labelled 0–20 "millimeters (mm)" and the frames are hourly, so mm per hour. The GEOS-FP assimilation
  collections on OPeNDAP have precipitation only as hourly means (`tavg1_2d_flx_Nx`). The 3-hourly
  instantaneous `inst3_2d_met_Nx` exists only for forecasts. Among the candidates at the same points, total
  precipitation fits best (all-point r 0.645 / 0.851). Liquid-only fits nearly as well (0.644 / 0.825), so
  snow makes little difference at these times. Convective-only fits worse (0.506 / 0.681, with a
  false-alarm ratio of 0.39 / 0.37). `prectot` is used.
- **PM2.5.** The suggested collection `gmao/geos-cf/assim/aqc_tavg_1hr_g1440x721_v1` (`pm25_rh35_gcc`) ends
  2026-01-02 11:30Z, so its successor, GEOS-CF v2 analysis `pm25_rh35`, is used.
- **A broken forecast dataset.** `fcast/tavg1_2d_slv_Nx/tavg1_2d_slv_Nx.20261103_18` serves a garbled time
  axis. Its time values jump between 2022 and 2026 and do not match its DAS. The time check catches this,
  and it is reported as an error inside `forecastCheck` rather than used.

## Limitations

- **Small sample.** Each layer is checked at one time plus one day earlier, with 400 points per frame. That
  gives about 100–130 rainy points for precipitation. `extra.allCells` repeats the comparison on every cell
  as a check on sampling noise.
- **Different averaging.** Decoded cells are the median (temp, PM2.5) or mean (precip) of about 32 frame
  pixels. Raw cells are the mean of 2–4 model points. For patchy fields like rain, part of the error is this
  difference, not decoding.
- **Analysis vs. forecast.** The newest frames are forecasts at render time, but the raw data is the
  analysis. Forecast collections are kept for only a few weeks and start-time naming varies (GEOS-CF uses
  `_09z`), so the forecast check is only diagnostic.
- **Precipitation timing.** Precipitation is compared with hourly means because no instantaneous analysis
  rate is published. Which hour the frames average over could not be determined.
- **PM2.5 scale.** The cause of the PM2.5 scale mismatch is unknown. The numbers above describe how the
  values decoded from the picture (no longer used by the app) relate to `pm25_rh35`, not which one is "right".
- **Reproducing exactly.** SVS keeps only the latest 372 hourly frames and re-renders them daily under the
  same names. Once 2026-11-04 rolls off the page, the exact frames of this run can only come from
  `pipeline/cache/accuracy/frames/`. A re-render of the same hour (analysis instead of forecast) can also
  change the newest-frame numbers slightly.
- **Run time.** With an empty cache, a full run makes about 320 OPeNDAP requests of about 1 MB. NCCS
  usually answers in 3–20 s each (occasionally minutes), so this takes 45–60 minutes with 3–4
  parallel requests. From cache it takes
  about 2 minutes.

## Reproduce

```sh
cd pipeline
.venv/bin/python -m pytest -q tests                       # offline, includes tests/test_accuracy.py
# newest covered frames (what CI does daily):
.venv/bin/python -m hearthbeat_pipeline.accuracy --out out/accuracy.json --n 400 --seed 2026 --layers temp precip pm25
# exactly this run's frame times:
.venv/bin/python -m hearthbeat_pipeline.accuracy --out out/accuracy.json --n 400 --seed 2026 \
    --at temp=2026-11-04T18:00Z precip=2026-11-04T20:00Z pm25=2026-11-04T05:00Z
```

Options: `--workers N` sets the number of parallel OPeNDAP requests (default 4). Delete
`pipeline/cache/opendap/` to refetch raw data.
