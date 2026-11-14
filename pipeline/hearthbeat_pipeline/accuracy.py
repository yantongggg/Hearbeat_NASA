"""How close are the values decoded from the SVS pictures to NASA's raw model output?

    python -m hearthbeat_pipeline.accuracy --out out/accuracy.json [--n 400] [--seed 2026] [--layers temp precip pm25]

For each layer: take the newest SVS frame whose time (plus the +-3 h offset
scan window) is covered by the raw OPeNDAP data, decode it exactly like the
app (build.build_lut + build.decode), sample N 1-degree cells (area-weighted,
seeded) and compare with the raw field averaged over the same cell. The frame
24 h earlier is evaluated too. See docs/ACCURACY.md for the method and results.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from . import build, grid, opendap, svs
from .layers import LAYERS

FP = "https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg"
CF = "https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/v2"
HALF = timedelta(minutes=30)
OFFSETS = range(-3, 4)            # offset scan, hours
RAIN_MM_H = 0.1                    # precipitation contingency threshold

# Raw subsets (OPeNDAP index ranges, inclusive): every other 0.25-degree latitude
# starting at -89.75 (two rows per 1-degree cell, +-0.25 deg from its centre) and
# every other longitude (GEOS-FP 0.3125 deg -> 0.625 deg, 1-2 points per cell;
# GEOS-CF 0.25 deg -> 0.5 deg starting at -179.75, 2 points per cell).
SUBSET = {
    "fp": ((1, 2, 719), (0, 2, 1150)),
    "cf": ((1, 2, 719), (1, 2, 1439)),
}


def _k_to_c(a):
    return a - 273.15


def _per_s_to_per_h(a):
    return a * 3600.0      # kg m-2 s-1 == mm s-1 -> mm/h


def _same(a):
    return a


@dataclass
class Source:
    label: str                 # human name, e.g. "GEOS-FP assim tavg1_2d_slv_Nx"
    url: str                   # OPeNDAP dataset URL
    vars: tuple[str, ...]
    kind: str                  # "inst": value at T | "tavg1": hourly means stamped mid-hour
    grid: str                  # key into SUBSET
    to_unit: Callable = _same
    combine: Callable | None = None   # several vars -> one field (default: the single var)
    expr: str = ""             # how the value is formed, for the report
    has_lev: bool = False
    fcast: Callable[[datetime], str] | None = None   # init time -> forecast dataset URL
    cycle: tuple[int, int] = (6, 0)  # forecast init spacing / first init hour

    def times(self, t: datetime) -> list[datetime]:
        """Raw time steps that make up the value at time t."""
        return [t] if self.kind == "inst" else [t - HALF, t + HALF]


def _fp(coll: str, *vars_: str, kind: str, conv, combine=None, expr="") -> Source:
    return Source(f"GEOS-FP assim {coll}", f"{FP}/assim/{coll}", vars_, kind, "fp", conv, combine,
                  expr or vars_[0], fcast=lambda i, c=coll: f"{FP}/fcast/{c}/{c}.{i:%Y%m%d_%H}", cycle=(6, 0))


CF_COLL = "aqc_tavg_1hr_glo_L1440x721_slv"


@dataclass
class Spec:
    main: Source               # field compared at the frame time
    scan: Source               # hourly source for the timing scan and forecast check
    alternatives: list[Source] = field(default_factory=list)   # other candidate fields at h=0
    notes: str = ""


SPECS: dict[str, Spec] = {
    "temp": Spec(
        main=_fp("inst3_2d_asm_Nx", "t2m", kind="inst", conv=_k_to_c, expr="t2m - 273.15 (instantaneous)"),
        scan=_fp("tavg1_2d_slv_Nx", "t2m", kind="tavg1", conv=_k_to_c,
                 expr="t2m - 273.15 (mean of the two hourly means around T)"),
        alternatives=[_fp("inst3_2d_asm_Nx", "t10m", kind="inst", conv=_k_to_c, expr="t10m - 273.15")],
        notes="SVS 5147 samples GEOS-FP 3-D fields 3 m above the surface; that field is not published "
              "on OPeNDAP, so the nearest raw field, 2 m air temperature (t2m), is used (10 m shown as an "
              "alternative). The frame time must be a 3-hourly synoptic time because inst3 t2m is 3-hourly.",
    ),
    "precip": Spec(
        main=_fp("tavg1_2d_flx_Nx", "prectot", kind="tavg1", conv=_per_s_to_per_h,
                 expr="prectot * 3600 (mean of the two hourly means around T)"),
        scan=_fp("tavg1_2d_flx_Nx", "prectot", kind="tavg1", conv=_per_s_to_per_h,
                 expr="prectot * 3600"),
        alternatives=[
            _fp("tavg1_2d_flx_Nx", "prectot", "precsno", kind="tavg1", conv=_per_s_to_per_h,
                combine=lambda a, b: a - b, expr="(prectot - precsno) * 3600 (liquid only)"),
            _fp("tavg1_2d_flx_Nx", "preccon", kind="tavg1", conv=_per_s_to_per_h,
                expr="preccon * 3600 (convective only)"),
        ],
        notes="GEOS-FP publishes precipitation on OPeNDAP only as hourly means (tavg1_2d_flx_Nx); no "
              "instantaneous rate is in the assimilation collections. Total precipitation (prectot, "
              "rain + snow) is the main candidate; liquid-only and convective-only are compared as "
              "alternatives. kg m-2 s-1 x 3600 = mm/h.",
    ),
    "pm25": Spec(
        main=Source("GEOS-CF v2 analysis " + CF_COLL, f"{CF}/ana/{CF_COLL}", ("pm25_rh35",), "tavg1", "cf",
                    expr="pm25_rh35 (mean of the two hourly means around T)", has_lev=True,
                    fcast=lambda i: f"{CF}/fcst/{CF_COLL}/{CF_COLL}.{i:%Y%m%d_%H}z", cycle=(24, 9)),
        scan=Source("GEOS-CF v2 analysis " + CF_COLL, f"{CF}/ana/{CF_COLL}", ("pm25_rh35",), "tavg1", "cf",
                    expr="pm25_rh35", has_lev=True,
                    fcast=lambda i: f"{CF}/fcst/{CF_COLL}/{CF_COLL}.{i:%Y%m%d_%H}z", cycle=(24, 9)),
        # the frame folders are 'GMAO_pm25 ... hwtool' (hyperwall tool): check GEOS-FP's own PM2.5 too
        alternatives=[Source("GEOS-FP assim inst1_2d_hwl_Nx", f"{FP}/assim/inst1_2d_hwl_Nx", ("pm25",), "inst",
                             "fp", lambda a: a * 1e9, expr="pm25 * 1e9 (GEOS-FP GOCART dry PM2.5, kg m-3 -> ug/m3)")],
        notes="GEOS-CF surface PM2.5 at 35 % RH (pm25_rh35, ug/m3, lowest model level 72). The v1 "
              "collection gmao/geos-cf/assim/aqc_tavg_1hr_g1440x721_v1 (pm25_rh35_gcc) ends "
              "2026-01-02 11:30Z, so the v2 analysis collection is used. GEOS-FP hyperwall pm25 is compared "
              "as an alternative source.",
    ),
}


# --------------------------------------------------------------------------- raw fields

def cell_mean(f: opendap.Field) -> np.ndarray:
    """Average raw points into the 1-degree app grid (row 0 = 89.5N, col 0 = -179.5E)."""
    rows = np.clip(np.floor(grid.LAT0 + 0.5 - f.lat).astype(int), 0, grid.H - 1)
    cols = np.floor(f.lon - (grid.LON0 - 0.5)).astype(int) % grid.W
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    ok = ~np.isnan(f.values)
    s = np.zeros((grid.H, grid.W))
    n = np.zeros((grid.H, grid.W))
    np.add.at(s, (rr[ok], cc[ok]), f.values[ok])
    np.add.at(n, (rr[ok], cc[ok]), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, s / n, np.nan)


class RawStore:
    """Fetches (dataset, var, time) cell grids once, in parallel."""

    def __init__(self, workers: int = 4):
        self.workers = workers
        self.ds: dict[str, opendap.Dataset] = {}
        self.grids: dict[tuple[str, str, datetime], np.ndarray] = {}
        self.urls: dict[tuple[str, str, datetime], list[str]] = {}

    def dataset(self, url: str, has_lev: bool = False) -> opendap.Dataset:
        if url not in self.ds:
            self.ds[url] = opendap.Dataset(url, has_lev)
        return self.ds[url]

    def covers(self, src: Source, times: list[datetime], url: str | None = None) -> bool:
        ax = self.dataset(url or src.url, src.has_lev).axis
        return all(ax.covers(t) for t in times)

    def prefetch(self, jobs: list[tuple[Source, datetime, str | None]]) -> None:
        todo = []
        for src, t, url in jobs:
            url = url or src.url
            self.dataset(url, src.has_lev)
            for v in src.vars:
                for tt in src.times(t):
                    k = (url, v, tt)
                    if k not in self.grids and k not in todo:
                        todo.append(k)
        for url, _, _ in todo:          # time axes first (not thread-safe to do lazily)
            self.dataset(url).axis
        sub = {k: SUBSET[next(s.grid for s, _, u in jobs if (u or s.url) == k[0])] for k in todo}

        def one(k):
            url, v, tt = k
            f = self.dataset(url).field(v, tt, *sub[k])
            return k, cell_mean(f), f.urls

        with ThreadPoolExecutor(self.workers) as ex:
            for k, g, urls in ex.map(one, todo):
                self.grids[k] = g
                self.urls[k] = urls

    def value(self, src: Source, t: datetime, url: str | None = None) -> np.ndarray:
        """(180, 360) cell grid of src at time t, in display units."""
        url = url or src.url
        self.prefetch([(src, t, url)])
        per_var = []
        for v in src.vars:
            gs = [self.grids[(url, v, tt)] for tt in src.times(t)]
            per_var.append(np.mean(gs, axis=0))
        out = src.combine(*per_var) if src.combine else per_var[0]
        return src.to_unit(out)

    def request_urls(self, src: Source, t: datetime) -> list[str]:
        return [u for v in src.vars for tt in src.times(t) for u in self.urls.get((src.url, v, tt), [])]


# --------------------------------------------------------------------------- statistics

def _f(x, nd: int = 4):
    if x is None:
        return None
    x = float(x)
    return None if not np.isfinite(x) else round(x, nd)


def pearson(a: np.ndarray, b: np.ndarray) -> float | None:
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.size < 3 or np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def error_stats(dec: np.ndarray, raw: np.ndarray) -> dict:
    """n, bias (decoded - raw), MAE, RMSE, Pearson r, median and 90th percentile |error|."""
    dec, raw = np.asarray(dec, float), np.asarray(raw, float)
    if dec.size == 0:
        return {"n": 0, "bias": None, "mae": None, "rmse": None, "r": None,
                "medianAbsErr": None, "p90AbsErr": None}
    e = dec - raw
    ae = np.abs(e)
    return {"n": int(dec.size), "bias": _f(e.mean()), "mae": _f(ae.mean()),
            "rmse": _f(np.sqrt((e ** 2).mean())), "r": _f(pearson(dec, raw)),
            "medianAbsErr": _f(np.median(ae)), "p90AbsErr": _f(np.percentile(ae, 90))}


def ols_slope(dec: np.ndarray, raw: np.ndarray) -> dict:
    """Least-squares fit decoded = a + b * raw."""
    if len(dec) < 3 or np.std(raw) == 0:
        return {"slope": None, "intercept": None}
    b, a = np.polyfit(np.asarray(raw, float), np.asarray(dec, float), 1)
    return {"slope": _f(b), "intercept": _f(a)}


def contingency(dec: np.ndarray, raw: np.ndarray, thr: float) -> dict:
    """Rain / no-rain table at threshold thr (value >= thr counts as rain)."""
    d, r = np.asarray(dec) >= thr, np.asarray(raw) >= thr
    hits, misses = int((d & r).sum()), int((~d & r).sum())
    fa, cn = int((d & ~r).sum()), int((~d & ~r).sum())
    return {"threshold": thr, "hits": hits, "misses": misses, "falseAlarms": fa, "correctNegatives": cn,
            "hitRate": _f(hits / (hits + misses)) if hits + misses else None,
            "falseAlarmRatio": _f(fa / (hits + fa)) if hits + fa else None,
            "frequencyBias": _f((hits + fa) / (hits + misses)) if hits + misses else None}


def log_stats(dec: np.ndarray, raw: np.ndarray) -> dict:
    """Errors in log10 space and relative errors (for positive, log-scaled fields)."""
    dec, raw = np.asarray(dec, float), np.asarray(raw, float)
    if dec.size == 0:
        return {}
    lr = np.log10(dec / raw)
    rel = np.abs(dec - raw) / raw
    return {"log10Bias": _f(lr.mean()), "log10Mae": _f(np.abs(lr).mean()),
            "log10Rmse": _f(np.sqrt((lr ** 2).mean())), "rLog": _f(pearson(np.log10(dec), np.log10(raw))),
            "medianRelErr": _f(np.median(rel)), "p90RelErr": _f(np.percentile(rel, 90)),
            "fac2": _f(np.mean((dec / raw >= 0.5) & (dec / raw <= 2)))}


def implied_range(layer, dec: np.ndarray, raw: np.ndarray) -> dict:
    """Diagnostic: least-squares fit of raw (in colorbar space: value, or log10 for a log bar) on the
    decoded colorbar position 0..1, evaluated at the bar ends. If the decoding were perfect this returns
    the labelled range; a different range points at a mislabelled bar, other units, or lightened colours."""
    dec, raw = np.asarray(dec, float), np.asarray(raw, float)
    if dec.size < 3:
        return {"min": None, "max": None}
    if layer.scale == "log":
        x = np.log(dec / layer.min) / np.log(layer.max / layer.min)
        y = np.log10(raw)
    else:
        x = (dec - layer.min) / (layer.max - layer.min)
        y = raw
    if np.std(x) == 0:
        return {"min": None, "max": None}
    b, a = np.polyfit(x, y, 1)
    lo, hi = (10 ** a, 10 ** (a + b)) if layer.scale == "log" else (a, a + b)
    return {"min": _f(lo), "max": _f(hi), "labelled": [layer.min, layer.max]}


def weighted_stats(dec: np.ndarray, raw: np.ndarray, w: np.ndarray) -> dict:
    """Area-weighted bias / MAE / RMSE (weights w), unweighted Pearson r, over all given cells."""
    if dec.size == 0:
        return {"n": 0, "bias": None, "mae": None, "rmse": None, "r": None}
    e = dec - raw
    return {"n": int(dec.size), "bias": _f(np.average(e, weights=w)), "mae": _f(np.average(np.abs(e), weights=w)),
            "rmse": _f(np.sqrt(np.average(e ** 2, weights=w))), "r": _f(pearson(dec, raw))}


def overlay_cells(layer) -> np.ndarray | None:
    """Grid cells touched by the layer's masked overlay boxes (logo, date label), which build.decode
    fills from neighbouring cells instead of reading colours. None if the layer has no overlays."""
    boxes = getattr(layer, "overlays", None)
    if not boxes:
        return None
    m = np.zeros((grid.H, grid.W), bool)
    for x0, y0, x1, y1 in boxes:
        m[int(y0 * grid.H):int(np.ceil(y1 * grid.H)), int(x0 * grid.W):int(np.ceil(x1 * grid.W))] = True
    return m


def sample_cells(valid: np.ndarray, n: int, seed: int) -> np.ndarray:
    """Flat indices of up to n valid cells, drawn without replacement with
    probability proportional to cell area (cos latitude). Sorted."""
    idx = np.flatnonzero(valid)
    if idx.size == 0:
        return idx
    lat = grid.LAT0 - (idx // grid.W) * grid.STEP
    w = np.cos(np.radians(lat))
    rng = np.random.default_rng(seed)
    pick = rng.choice(idx, size=min(n, idx.size), replace=False, p=w / w.sum())
    return np.sort(pick)


def best_offset(scan: list[dict], by: str = "r") -> float | None:
    """Offset with the highest correlation `by`; ties go to the smaller shift."""
    ok = [s for s in scan if s.get(by) is not None]
    if not ok:
        return None
    return max(ok, key=lambda s: (round(s[by], 4), -abs(s["h"])))["h"]


# --------------------------------------------------------------------------- per frame

def frame_needs(spec: Spec, t: datetime) -> list[tuple[Source, list[datetime]]]:
    scan_t = [t + timedelta(hours=h) for h in OFFSETS]
    return [(spec.main, spec.main.times(t)),
            (spec.scan, sorted({x for s in scan_t for x in spec.scan.times(s)}))]


def frame_covered(store: RawStore, spec: Spec, t: datetime) -> bool:
    return all(store.covers(src, ts) for src, ts in frame_needs(spec, t))


def decode_frame(key: str, frame, lut) -> tuple[np.ndarray, Path, datetime | None]:
    rendered = svs.head_last_modified(frame.url)
    # SVS reuses frame file names every day: cache by render time so a stale image is never reused
    sub = f"accuracy/frames/{key}/{rendered:%Y%m%dT%H%MZ}" if rendered else f"accuracy/frames/{key}/unknown"
    p = svs.cached(frame.url, sub)
    rgb = np.asarray(Image.open(p).convert("RGB"))
    g, _ = build.decode(LAYERS[key], lut, rgb)
    return g, p, rendered


def evaluate_frame(key: str, spec: Spec, frame, lut, store: RawStore, n: int, seed: int,
                   forecast_check: bool) -> dict:
    layer = LAYERS[key]
    t = frame.time
    dec_grid, _, rendered = decode_frame(key, frame, lut)

    jobs = [(spec.main, t, None)] + [(spec.scan, t + timedelta(hours=h), None) for h in OFFSETS]
    store.prefetch(jobs)
    raw_grid = store.value(spec.main, t)

    valid = ~np.isnan(dec_grid) & ~np.isnan(raw_grid)
    cells = sample_cells(valid, n, seed)
    rows, cols = cells // grid.W, cells % grid.W
    dec = dec_grid.ravel()[cells]
    raw = raw_grid.ravel()[cells]
    lo, hi = layer.min, layer.max
    clipped = (raw < lo) | (raw > hi)
    keep = ~clipped
    d, r = dec[keep], raw[keep]

    res: dict = {"frame": frame.url, "frameTime": t.strftime("%Y-%m-%dT%H:%MZ"),
                 "frameRendered": rendered.strftime("%Y-%m-%dT%H:%MZ") if rendered else None,
                 "raw": {"dataset": spec.main.label, "variable": spec.main.expr, "url": spec.main.url,
                         "time": t.strftime("%Y-%m-%dT%H:%MZ"),
                         "rawSteps": [x.strftime("%Y-%m-%dT%H:%MZ") for x in spec.main.times(t)],
                         "spatial": "mean of the raw points of the strided subset inside each 1-degree cell",
                         "requests": store.request_urls(spec.main, t)},
                 "sampled": int(cells.size), "validCells": int(valid.sum())}
    extra: dict = {}

    if key == "precip":
        rainy = (r >= RAIN_MM_H) | (d >= RAIN_MM_H)
        res.update(error_stats(d[rainy], r[rainy]))
        extra["statsDefinition"] = (f"top-level error stats use rainy points only (decoded or raw >= {RAIN_MM_H} "
                                    "mm/h); allPoints includes dry points")
        extra["allPoints"] = error_stats(d, r)
        extra["contingency"] = contingency(d, r, RAIN_MM_H)
        rv = valid & (raw_grid <= hi)
        extra["contingencyAllCells"] = contingency(dec_grid[rv], raw_grid[rv], RAIN_MM_H)
        extra["olsRainy"] = ols_slope(d[rainy], r[rainy])
        extra["impliedRange"] = implied_range(layer, d[rainy], r[rainy])
        extra["meanRainy"] = {"decoded": _f(d[rainy].mean()) if rainy.any() else None,
                              "raw": _f(r[rainy].mean()) if rainy.any() else None}
    else:
        res.update(error_stats(d, r))
        extra["ols"] = ols_slope(d, r)
        extra["impliedRange"] = implied_range(layer, d, r)
    if key == "pm25":
        extra["log"] = log_stats(d, r)
    res["clipped"] = int(clipped.sum())
    if clipped.any():
        extra["clippedDetail"] = {
            "belowMin": int((raw < lo).sum()), "aboveMax": int((raw > hi).sum()),
            "meanAbsErrVsClippedRaw": _f(np.abs(dec[clipped] - np.clip(raw[clipped], lo, hi)).mean())}
    # every valid, unclipped cell (area-weighted), split into cells measured from colours and cells
    # hidden by the logo / date label that build.decode fills from neighbours
    av = valid & (raw_grid >= lo) & (raw_grid <= hi)
    w = np.cos(np.radians(grid.LAT0 - np.arange(grid.H) * grid.STEP))[:, None] * np.ones((1, grid.W))
    ov = overlay_cells(layer)
    extra["allCells"] = weighted_stats(dec_grid[av], raw_grid[av], w[av])
    if ov is not None:
        extra["allCells"]["measured"] = weighted_stats(dec_grid[av & ~ov], raw_grid[av & ~ov], w[av & ~ov])
        extra["allCells"]["overlayFilled"] = weighted_stats(dec_grid[av & ov], raw_grid[av & ov], w[av & ov])
        res["sampledOverlayCells"] = int(ov.ravel()[cells].sum())

    # timing scan on the same (unclipped) points; raw at other hours clipped to the colorbar range.
    # For a log colorbar the scan also reports r of log10 values (rLog), which then picks the best offset.
    pts = Points(cells, keep, d, lo, hi, layer.scale == "log")
    scan, hourly = timing_scan(store, spec.scan, t, pts)
    res["offsetScan"] = scan
    res["bestOffsetHours"] = best_offset(scan, pts.by)
    if hourly:
        extra["hourlyMeanScan"] = {
            "what": f"each native hourly mean of {spec.scan.vars[0]} on its own; h = centre of the averaging "
                    "hour minus frame time", "scan": hourly}
    extra["scanSource"] = {"dataset": spec.scan.label, "variable": spec.scan.expr, "url": spec.scan.url}

    if spec.alternatives:
        alts = [{"variable": spec.main.expr, "dataset": spec.main.label, **_alt_stats(key, d, r)}]
        for a in spec.alternatives:
            try:
                ra = np.clip(store.value(a, t).ravel()[cells][keep], lo, hi)
                alts.append({"variable": a.expr, "dataset": a.label, **_alt_stats(key, d, ra)})
            except Exception as e:  # noqa: BLE001 - an unavailable alternative is reported, not fatal
                alts.append({"variable": a.expr, "dataset": a.label, "error": str(e)[:300]})
        extra["fieldCheck"] = alts

    if forecast_check and spec.scan.fcast:
        fc = _forecast_check(spec, store, t, rendered, pts, key)
        extra["forecastCheck"] = fc
        ok = [x for x in fc if x.get("r") is not None]
        if ok:   # timing scan against the forecast that matches the frame best
            best = max(ok, key=lambda x: x["r"])
            try:
                fscan, fhourly = timing_scan(store, spec.scan, t, pts, best["url"])
                extra["forecastScan"] = {"init": best["init"], "url": best["url"], "offsetScan": fscan,
                                         "bestOffsetHours": best_offset(fscan, pts.by), "hourlyMeanScan": fhourly}
            except Exception as e:  # noqa: BLE001
                extra["forecastScan"] = {"init": best["init"], "url": best["url"], "error": str(e)[:300]}
    res["extra"] = extra
    return res


@dataclass
class Points:
    """The sampled, unclipped points of one frame and how to score them."""
    cells: np.ndarray
    keep: np.ndarray
    dec: np.ndarray
    lo: float
    hi: float
    log: bool

    @property
    def by(self) -> str:
        return "rLog" if self.log else "r"

    def raw_at(self, g: np.ndarray) -> np.ndarray:
        return np.clip(g.ravel()[self.cells][self.keep], self.lo, self.hi)

    def score(self, h, g: np.ndarray) -> dict:
        rh = self.raw_at(g)
        st = error_stats(self.dec, rh)
        e = {"h": h, "r": st["r"], "rmse": st["rmse"]}
        if self.log:
            e["rLog"] = _f(pearson(np.log10(self.dec), np.log10(rh)))
        return e


def timing_scan(store: RawStore, src: Source, t: datetime, pts: Points,
                url: str | None = None) -> tuple[list[dict], list[dict]]:
    """Scores at raw times T+h (h = -3..3) and, for hourly means, each native hour on its own."""
    store.prefetch([(src, t + timedelta(hours=h), url) for h in OFFSETS])
    scan = [pts.score(h, store.value(src, t + timedelta(hours=h), url)) for h in OFFSETS]
    hourly = []
    if src.kind == "tavg1":
        for k in range(-3, 5):
            tt = t + timedelta(hours=k) - HALF
            g = src.to_unit(store.grids[(url or src.url, src.vars[0], tt)])
            hourly.append(pts.score(k - 0.5, g))
    return scan, hourly


def _alt_stats(key: str, d: np.ndarray, r: np.ndarray) -> dict:
    st = error_stats(d, r)
    out = {"n": st["n"], "bias": st["bias"], "rmse": st["rmse"], "r": st["r"], **ols_slope(d, r)}
    if key == "precip":
        c = contingency(d, r, RAIN_MM_H)
        out.update(hitRate=c["hitRate"], falseAlarmRatio=c["falseAlarmRatio"])
    if key == "pm25":
        lg = log_stats(d, r)
        out.update(log10Bias=lg.get("log10Bias"), rLog=lg.get("rLog"))
    return out


def _forecast_check(spec: Spec, store: RawStore, t: datetime, rendered: datetime | None,
                    pts: "Points", key: str) -> list[dict]:
    """Compare the frame with GEOS forecasts started in the 24 h before the frames were rendered:
    if a forecast matches much better than the analysis, the frame shows that forecast."""
    src = spec.scan
    every, first = src.cycle
    ref = min(rendered or t, t)
    base = ref.replace(minute=0, second=0, microsecond=0)
    inits = [base - timedelta(hours=h) for h in range(0, 25)]
    inits = [i for i in inits if (i.hour - first) % every == 0][:4]
    out = []
    for init in inits:
        url = src.fcast(init)
        try:
            if not store.covers(src, src.times(t), url):
                out.append({"init": f"{init:%Y-%m-%dT%HZ}", "url": url, "error": "frame time not covered"})
                continue
            store.prefetch([(src, t, url)])
            rf = pts.raw_at(store.value(src, t, url))
            d = pts.dec
            st = error_stats(d, rf)
            item = {"init": f"{init:%Y-%m-%dT%HZ}", "leadHours": (t - init).total_seconds() / 3600,
                    "url": url, "variable": src.expr,
                    **{k: st[k] for k in ("n", "bias", "mae", "rmse", "r")}}
            if key == "precip":
                c = contingency(d, rf, RAIN_MM_H)
                item.update(hitRate=c["hitRate"], falseAlarmRatio=c["falseAlarmRatio"])
            out.append(item)
        except Exception as e:  # noqa: BLE001 - a missing forecast is a result, not a crash
            out.append({"init": f"{init:%Y-%m-%dT%HZ}", "url": url, "error": str(e)[:300]})
    return out


# --------------------------------------------------------------------------- driver

METHOD = (
    "Frames: newest SVS frame whose time T, and the raw times needed for the +-3 h scan, are covered by the raw "
    "OPeNDAP aggregation (frame times from build.discover); plus the frame 24 h earlier (extra.dayEarlier). "
    "Decoding: build.build_lut + build.decode, i.e. exactly the float grid the app quantises. "
    "Raw: GDS ASCII subsets (every 2nd 0.25-degree latitude, every 2nd longitude), averaged over the points "
    "inside each 1-degree cell (GEOS-FP 2-4 points, GEOS-CF 4 points). 'tavg1' sources are hourly means "
    "stamped mid-hour; the value at T is the mean of the hours T-1..T and T..T+1. "
    "Sampling: n cells without replacement, probability proportional to cos(latitude), numpy default_rng(seed), "
    "among cells where decoded and raw are both valid. Points whose raw value is outside the colorbar range are "
    "counted in 'clipped' and excluded from the stats. bias = mean(decoded - raw). "
    "Offset scan: same points, raw at T+h (h=-3..3) from the hourly source, clipped to the colorbar range; "
    "bestOffsetHours = argmax r (for the log-scale PM2.5 bar: argmax r of log10 values). "
    "extra.allCells: every valid unclipped cell, area-weighted, split into colour-measured cells and cells under "
    "the logo/date-label overlays that the decoder fills from neighbours. extra.forecastCheck: the same points "
    "against GEOS forecasts started in the 24 h before the frames were rendered; extra.forecastScan repeats the "
    "timing scan against the best-matching forecast. extra.impliedRange: least-squares "
    "fit of raw on decoded colorbar position, evaluated at the bar ends (diagnostic)."
)


def pick_frames(store: RawStore, spec: Spec, frames: list, at: datetime | None) -> tuple:
    frames = sorted(frames, key=lambda f: f.time)
    if at is not None:
        cand = [f for f in frames if f.time == at]
        if not cand:
            raise RuntimeError(f"no frame at {at:%Y-%m-%dT%H:%MZ} (frames {frames[0].time:%Y-%m-%dT%HZ} .. "
                               f"{frames[-1].time:%Y-%m-%dT%HZ})")
        if not frame_covered(store, spec, at):
            raise RuntimeError(f"raw data does not cover {at:%Y-%m-%dT%H:%MZ} +-3.5 h")
        a = cand[0]
    else:
        a = next((f for f in reversed(frames) if frame_covered(store, spec, f.time)), None)
        if a is None:
            axes = {s.url: store.dataset(s.url, s.has_lev).axis for s in (spec.main, spec.scan)}
            raise RuntimeError("no frame covered by the raw data: frames "
                               f"{frames[0].time:%Y-%m-%dT%HZ}..{frames[-1].time:%Y-%m-%dT%HZ}; raw "
                               + "; ".join(f"{u.rsplit('/', 1)[-1]} {x.start:%Y-%m-%dT%H:%MZ}..{x.end:%Y-%m-%dT%H:%MZ}"
                                           for u, x in axes.items()))
    prev = a.time - timedelta(hours=24)
    b = next((f for f in frames if f.time == prev and frame_covered(store, spec, f.time)), None)
    return a, b


def run_layer(key: str, store: RawStore, n: int, seed: int, at: datetime | None) -> dict:
    spec = SPECS[key]
    layer = LAYERS[key]
    frames, cb_url, timing = build.discover(layer)
    lut = build.build_lut(layer, svs.cached(cb_url, "colorbars"))
    a, b = pick_frames(store, spec, frames, at)
    print(f"[{key}] frame {a.url.rsplit('/', 1)[-1]} at {a.time:%Y-%m-%d %H:%MZ}"
          + (f", day-earlier {b.time:%Y-%m-%d %H:%MZ}" if b else ""), flush=True)
    res = evaluate_frame(key, spec, a, lut, store, n, seed, forecast_check=True)
    out = {"unit": layer.unit, "colorbarRange": {"scale": layer.scale, "min": layer.min, "max": layer.max},
           "timing": timing, **res}
    if b is not None:
        try:
            out["extra"]["dayEarlier"] = evaluate_frame(key, spec, b, lut, store, n, seed, forecast_check=False)
        except Exception as e:  # noqa: BLE001
            out["extra"]["dayEarlier"] = {"error": str(e)[:300]}
    out["notes"] = spec.notes
    return out


def _parse_at(s: str) -> tuple[str, datetime]:
    k, _, v = s.partition("=")
    t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return k, (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def summary_table(result: dict) -> str:
    lines = [f"{'layer':7} {'frame (UTC)':17} {'n':>4} {'bias':>8} {'MAE':>7} {'RMSE':>7} {'r':>6} "
             f"{'medAE':>7} {'p90AE':>7} {'clip':>4} {'best h':>6}"]
    for k, v in result["layers"].items():
        lines.append(f"{k:7} {v['frameTime']:17} {v['n']:4d} {v['bias']!s:>8} {v['mae']!s:>7} {v['rmse']!s:>7} "
                     f"{v['r']!s:>6} {v['medianAbsErr']!s:>7} {v['p90AbsErr']!s:>7} {v['clipped']:4d} "
                     f"{v['bestOffsetHours']!s:>6}")
        de = v["extra"].get("dayEarlier")
        if de and "error" not in de:
            lines.append(f"{'  -24h':7} {de['frameTime']:17} {de['n']:4d} {de['bias']!s:>8} {de['mae']!s:>7} "
                         f"{de['rmse']!s:>7} {de['r']!s:>6} {de['medianAbsErr']!s:>7} {de['p90AbsErr']!s:>7} "
                         f"{de['clipped']:4d} {de['bestOffsetHours']!s:>6}")
    for k, e in result["errors"].items():
        lines.append(f"{k:7} FAILED {e}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--layers", nargs="*", default=list(SPECS), choices=list(SPECS))
    ap.add_argument("--at", nargs="*", default=[], metavar="LAYER=TIME",
                    help="force the frame time, e.g. temp=2026-11-04T18:00Z (default: newest covered)")
    ap.add_argument("--workers", type=int, default=4, help="parallel OPeNDAP requests")
    a = ap.parse_args(argv)
    at = dict(_parse_at(s) for s in a.at)

    store = RawStore(a.workers)
    result = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
              "seed": a.seed, "nRequested": a.n, "method": METHOD, "layers": {}, "errors": {}}
    for k in a.layers:
        try:
            result["layers"][k] = run_layer(k, store, a.n, a.seed, at.get(k))
        except Exception as e:  # noqa: BLE001 - record and continue with the other layers
            traceback.print_exc()
            result["errors"][k] = f"{type(e).__name__}: {e}"[:500]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(summary_table(result))
    print(f"wrote {a.out}")
    return 0 if result["layers"] else 1


if __name__ == "__main__":
    sys.exit(main())
